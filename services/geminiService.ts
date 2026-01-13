
import { GoogleGenAI } from "@google/genai";
import type { Scene } from '../types';

if (!process.env.API_KEY) {
    throw new Error("API_KEY environment variable not set");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const CAMERA_SHOTS = [
    '一张全身照，从头到脚捕捉整个服装。',
    '一张中景照片，从腰部向上取景，专注于上衣和短裤的细节。',
    '一张牛仔式镜头，从大腿中部向上取景，展示靴子和短裤的搭配效果。',
    '一张动态的低角度照片，使模特看起来充满力量，并强调服装的轮廓。'
];

async function processImageGenerationResponse(responsePromise: Promise<any>): Promise<string> {
    const response = await responsePromise;

    // Successful case: find and return image data
    if (response?.candidates?.[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
            if (part.inlineData?.data) {
                return part.inlineData.data;
            }
        }
    }

    // Failure case: Analyze reason and throw a descriptive error
    if (response?.candidates?.[0]?.finishReason === 'SAFETY') {
        throw new Error('图片生成失败，因为内容可能违反了安全政策。请调整提示词后重试。');
    }

    const textResponse = response?.text;
    if (textResponse) {
        console.error("Unexpected text response from image generation:", textResponse);
        throw new Error('图片生成失败：模型返回了文本而不是图片。');
    }

    throw new Error('图片生成失败：收到来自AI的无效或空响应。');
}

export const extractClothing = async (imageBase64: string, mimeType: string): Promise<string> => {
    const response = ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
            parts: [
                {
                    text: 'Isolate and extract the primary clothing item(s) worn by the person in the image. Ensure the original texture, shape, and color are perfectly preserved. The resulting image must have a completely transparent background. Exclude any part of the model, background, or other objects—only the clothing should be visible, as if floating in empty space.',
                },
                {
                    inlineData: {
                        data: imageBase64,
                        mimeType: mimeType,
                    },
                },
            ],
        },
    });
    return processImageGenerationResponse(response);
};

export const generateWithLockedScene = async (clothingImageBase64: string, sceneImageBase64: string, sceneImageMimeType: string, aspectRatio: string, onProgress?: (index: number) => void): Promise<string[]> => {
    const fullPrompt = `你是一位专业的时尚照片编辑器。你的任务是使用第一张图片（模板图）作为模特、姿势、背景、光照和整体构图的严格模板。你的目标是将第二张图片（服装图）中提供的新服装，智能地替换掉模板图中主要的服装。

重要规则：
1.  **完美保留模板**：模特的姿势、表情、背景、光照、道具（如项链、杂志）以及照片的整体氛围必须与模板图保持完全相同。
2.  **智能替换**：识别出模板图中最主要的服装。如果模板图中有一只手正在与服装互动（例如捏、拉），那么被替换的新服装也必须与这只手进行完全相同的、自然的互动。
3.  **保持一致性**：替换后的服装必须无缝地融入场景，看起来就像是原始照片的一部分。确保光照和阴影在新服装上的表现与模板图一致。

最终的图片应该是一张高分辨率、照片般逼真的时尚照片，它看起来就像是模板图的另一个版本，只是服装不同。`;

    const generationPromises = Array(4).fill(0).map((_, i) => {
        onProgress?.(i);
        const responsePromise = ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: {
                parts: [
                    { text: fullPrompt },
                    { // Locked Scene Image (Template)
                        inlineData: {
                            data: sceneImageBase64,
                            mimeType: sceneImageMimeType,
                        },
                    },
                    { // New Clothing Image
                        inlineData: {
                            data: clothingImageBase64,
                            mimeType: 'image/png', // The extracted clothing is always PNG with transparency
                        },
                    },
                ],
            },
            config: {
                imageConfig: {
                    aspectRatio: aspectRatio
                }
            }
        });
        return processImageGenerationResponse(responsePromise);
    });

    const results = await Promise.allSettled(generationPromises);
    const successfulResults: string[] = [];
    results.forEach(result => {
        if (result.status === 'fulfilled') {
            successfulResults.push(result.value);
        } else {
            console.error("A single image generation failed:", result.reason);
        }
    });

    if (successfulResults.length === 0) {
        const firstRejection = results.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined;
        if (firstRejection) {
            throw firstRejection.reason;
        }
        throw new Error('所有图片生成均失败。请检查您的提示词或稍后再试。');
    }

    return successfulResults;
};


export const generateScenes = async (clothingImageBase64: string, scene: Scene, aspectRatio: string, colorPrompt?: string, onProgress?: (index: number) => void): Promise<string[]> => {
    
    let scenePrompt = scene.prompt;

    if (scene.name === '同款多色合集' && colorPrompt && colorPrompt.trim() !== '') {
        const colorInstruction = `关键区别在于：每位模特的服装颜色都必须不同，并使用以下指定的颜色：${colorPrompt}。`;
        scenePrompt = scene.prompt.replace(
            /请为这三套服装生成一个和谐且吸引人的调色盘（例如：原色、米白色、雾霾蓝）。/g,
            colorInstruction
        );
    }

    const isComplexPrompt = scenePrompt.includes('人物') || scenePrompt.includes('模特') || scenePrompt.length > 200;

    const generationPromises = CAMERA_SHOTS.map((shot, i) => {
        onProgress?.(i);
        let fullPrompt: string;

        if (isComplexPrompt) {
            // For detailed prompts that describe the whole scene including subjects
            fullPrompt = `根据以下详细描述，创建一张高质量、超写实的时尚照片。场景中的人物和/或人体模特必须只穿着输入图像中提供的服装，不要添加任何额外的衣物。严格禁止以任何方式修改服装——必须完美保持其原始的款式、颜色、质地和合身度。最终图像应为${aspectRatio}宽高比。\n\n场景描述：${scenePrompt}\n\n请使用以下镜头角度来拍摄此场景：${shot}`;
        } else {
            // For simple background prompts
            fullPrompt = `创建一张高质量、逼真的时尚广告照片。主要拍摄对象是一名时装模特。${shot} 模特必须只穿着输入图像中提供的服装，不要添加任何额外的衣物。严格禁止以任何方式修改服装——必须完美保持其原始的款式、颜色、质地和合身度。背景是 ${scenePrompt}。模特应该摆出自然、自信的姿势，与服装和场景相得益彰。灯光必须专业，与背景场景完美匹配。最终图像应为${aspectRatio}宽高比。`;
        }
        
        const responsePromise = ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: {
                parts: [
                    { text: fullPrompt },
                    {
                        inlineData: {
                            data: clothingImageBase64,
                            mimeType: 'image/png', // The extracted clothing is always PNG with transparency
                        },
                    },
                ],
            },
            config: {
                imageConfig: {
                    aspectRatio: aspectRatio
                }
            }
        });
        return processImageGenerationResponse(responsePromise);
    });

    const results = await Promise.allSettled(generationPromises);
    const successfulResults: string[] = [];
    results.forEach(result => {
        if (result.status === 'fulfilled') {
            successfulResults.push(result.value);
        } else {
            console.error("A single image generation failed:", result.reason);
        }
    });

    if (successfulResults.length === 0) {
        const firstRejection = results.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined;
        if (firstRejection) {
            throw firstRejection.reason;
        }
        throw new Error('所有图片生成均失败。请检查您的提示词或稍后再试。');
    }

    return successfulResults;
};

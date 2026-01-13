
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import SceneSelector from './components/SceneSelector';
import ImageModal from './components/ImageModal';
import AspectRatioSelector from './components/AspectRatioSelector';
import { extractClothing, generateScenes, generateWithLockedScene } from './services/geminiService';
import { urlToBase64, fileToBase64, downloadImage, fileToDataUrl } from './utils/imageUtils';
import type { Scene } from './types';
import { SCENES, ORIGINAL_IMAGE_URL } from './constants';

const ASPECT_RATIOS = [
    { value: '9:16', label: '竖屏' },
    { value: '1:1', label: '方形' },
    { value: '16:9', label: '横屏' },
    { value: '4:3', label: '经典' },
];

const RPM_LIMIT = 60;
const TIME_WINDOW_MS = 60 * 1000;
const REQUESTS_PER_GENERATION = 5; // 1 for extraction + 4 for generation

const LoadingSpinner: React.FC = () => (
    <svg className="animate-spin -ml-1 mr-3 h-8 w-8 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
);

const LockIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
);

const App: React.FC = () => {
    const [selectedScene, setSelectedScene] = useState<Scene>(SCENES[0]);
    const [selectedAspectRatio, setSelectedAspectRatio] = useState<string>('9:16');
    const [colorPrompt, setColorPrompt] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [isQueued, setIsQueued] = useState<boolean>(false);
    const [loadingStep, setLoadingStep] = useState<string>('');
    const [generatedImages, setGeneratedImages] = useState<string[] | null>(null);
    const [modalImageSrc, setModalImageSrc] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [uploadedImage, setUploadedImage] = useState<{ url: string; base64: string; mimeType: string } | null>(null);
    const [lockedSceneImage, setLockedSceneImage] = useState<{ url: string; base64: string; mimeType: string } | null>(null);
    const [requestTimestamps, setRequestTimestamps] = useState<number[]>([]);
    const [currentTime, setCurrentTime] = useState(Date.now());

    useEffect(() => {
        const timer = setInterval(() => {
            setCurrentTime(Date.now());
        }, 1000); // Update time every second to refresh quota display
        return () => clearInterval(timer);
    }, []);

    const remainingQuota = useMemo(() => {
        const recentTimestamps = requestTimestamps.filter(ts => currentTime - ts < TIME_WINDOW_MS);
        return Math.max(0, RPM_LIMIT - recentTimestamps.length);
    }, [requestTimestamps, currentTime]);


    const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        try {
            const base64 = await fileToBase64(file);
            const url = await fileToDataUrl(file);
            setUploadedImage({ url, base64, mimeType: file.type });
        } catch (error) {
            console.error("Error converting file to base64:", error);
            setError('图片上传失败，请重试。');
        }
    };

    const handleLockedSceneUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        try {
            const base64 = await fileToBase64(file);
            const url = await fileToDataUrl(file);
            setLockedSceneImage({ url, base64, mimeType: file.type });
        } catch (error) {
            console.error("Error converting file to data URL:", error);
            setError('锁定场景图片上传失败，请重试。');
        }
    };

    const handleClearUpload = () => {
        setUploadedImage(null);
    };

    const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setSelectedScene(prevScene => ({
            ...prevScene,
            prompt: e.target.value
        }));
    };

    const handleLockScene = (imageSrc: string) => {
        const parts = imageSrc.split(',');
        if (parts.length < 2) return;
        const base64 = parts[1];
        const mimeType = parts[0].match(/:(.*?);/)?.[1] ?? 'image/png';
        setLockedSceneImage({ url: imageSrc, base64, mimeType });
    };

    const handleClearLockedScene = () => {
        setLockedSceneImage(null);
    };

    const performGeneration = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        setGeneratedImages(null);

        try {
            // Check quota again right before execution
            const now = Date.now();
            const currentTimestamps = requestTimestamps.filter(ts => now - ts < TIME_WINDOW_MS);
            if (RPM_LIMIT - currentTimestamps.length < REQUESTS_PER_GENERATION) {
                 setError(`额度不足。需要 ${REQUESTS_PER_GENERATION} 次调用，但当前剩余不足。`);
                 setIsLoading(false);
                 return;
            }

            setLoadingStep(uploadedImage ? '转换上传图片中...' : '转换原始图片中...');
            const imageToProcess = uploadedImage
                ? { base64: uploadedImage.base64, mimeType: uploadedImage.mimeType }
                : { base64: await urlToBase64(ORIGINAL_IMAGE_URL), mimeType: 'image/jpeg' };

            setLoadingStep('从图片中提取服装 (1/5)...');
            const extractedClothingBase64 = await extractClothing(imageToProcess.base64, imageToProcess.mimeType);
            const afterExtractionTimestamp = Date.now();

            let newImageBase64Array: string[];
            const generationStepPrefix = lockedSceneImage ? '在锁定场景中生成' : '生成新场景';

            if (lockedSceneImage) {
                setLoadingStep(`${generationStepPrefix} (2/5)...`);
                const { base64: lockedSceneBase64, mimeType: lockedSceneMimeType } = lockedSceneImage;
                newImageBase64Array = await generateWithLockedScene(extractedClothingBase64, lockedSceneBase64, lockedSceneMimeType, selectedAspectRatio, (i) => {
                    setLoadingStep(`${generationStepPrefix} (${i + 2}/5)...`);
                });
            } else {
                setLoadingStep(`${generationStepPrefix} (2/5)...`);
                newImageBase64Array = await generateScenes(extractedClothingBase64, selectedScene, selectedAspectRatio, colorPrompt, (i) => {
                    setLoadingStep(`${generationStepPrefix} (${i + 2}/5)...`);
                });
            }
            
            const finalTimestamp = Date.now();
            const newTimestamps = [
                afterExtractionTimestamp,
                ...Array(newImageBase64Array.length).fill(finalTimestamp)
            ];

            setRequestTimestamps(prev => {
                const now = Date.now();
                const recentPrev = prev.filter(ts => now - ts < TIME_WINDOW_MS);
                return [...recentPrev, ...newTimestamps];
            });

            setGeneratedImages(newImageBase64Array.map(img => `data:image/png;base64,${img}`));

        } catch (err) {
            console.error(err);
            const errorMessage = err instanceof Error ? err.message : String(err);
            
            // Check for specific quota error messages
            if (errorMessage.includes('超额') || errorMessage.toLowerCase().includes('quota')) {
                // It's a quota error. We should queue the request and update our local
                // rate-limiting to prevent an infinite loop of failed requests.
                
                // Add timestamps to our client-side tracker to reflect the failed attempt,
                // effectively pausing retries until the time window clears.
                const now = Date.now();
                const failedAttemptTimestamps = Array(REQUESTS_PER_GENERATION).fill(now);
                setRequestTimestamps(prev => {
                    const recentPrev = prev.filter(ts => now - ts < TIME_WINDOW_MS);
                    return [...recentPrev, ...failedAttemptTimestamps];
                });

                // Set the state to queued. The UI will update and the useEffect will handle the retry.
                setIsQueued(true);
            } else {
                // It's a different error, so show it to the user.
                setError(errorMessage);
            }
        } finally {
            setIsLoading(false);
            setLoadingStep('');
        }
    }, [selectedScene, uploadedImage, selectedAspectRatio, colorPrompt, lockedSceneImage, requestTimestamps]);

    const handleGenerate = useCallback(() => {
        if (remainingQuota < REQUESTS_PER_GENERATION) {
            setIsQueued(true);
        } else {
            performGeneration();
        }
    }, [remainingQuota, performGeneration]);

    useEffect(() => {
        if (isQueued && remainingQuota >= REQUESTS_PER_GENERATION) {
            setIsQueued(false);
            performGeneration();
        }
    }, [isQueued, remainingQuota, performGeneration]);
    
    const openModal = (src: string) => setModalImageSrc(src);
    const closeModal = () => setModalImageSrc(null);

    const isSceneSelectionDisabled = !!lockedSceneImage;

    const getQuotaColor = () => {
        if (remainingQuota < REQUESTS_PER_GENERATION) return 'text-red-500';
        if (remainingQuota <= 10) return 'text-yellow-400';
        return 'text-green-400';
    };

    const getButtonText = () => {
        if (isLoading) return '生成中...';
        if (isQueued) return '排队中...';
        return lockedSceneImage ? '✨ 在锁定场景中生成' : '✨ 生成 4 张新图片';
    };

    return (
        <div className="bg-gray-900 text-white min-h-screen">
            <main className="container mx-auto px-4 py-8">
                <header className="text-center mb-12">
                    <h1 className="text-4xl md:text-5xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-pink-600">
                        AI 时尚场景设计师
                    </h1>
                    <p className="mt-4 text-lg text-gray-400 max-w-2xl mx-auto">
                        从照片中提取服装，并立即在各种新场景中生成专业的产品图。
                    </p>
                </header>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-start">
                    {/* Control Panel */}
                    <div className="bg-gray-800/50 rounded-2xl p-6 shadow-2xl backdrop-blur-sm border border-gray-700/50 flex flex-col gap-6">
                        <div>
                            <h2 className="text-2xl font-semibold mb-4 text-gray-200">1. 上传服装图片</h2>
                            <div className="aspect-square w-full rounded-lg overflow-hidden mb-4 border-2 border-gray-700">
                                <img src={uploadedImage ? uploadedImage.url : ORIGINAL_IMAGE_URL} alt="服装模型" className="w-full h-full object-cover" />
                            </div>
                            <div className="flex gap-4">
                                <label htmlFor="file-upload" className="cursor-pointer flex-1 text-center bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white font-medium py-2 px-4 rounded-lg transition-colors">
                                    上传图片
                                </label>
                                <input id="file-upload" type="file" className="hidden" accept="image/*" onChange={handleImageUpload} />
                                {uploadedImage && (
                                    <button onClick={handleClearUpload} className="flex-1 text-center bg-pink-800 text-gray-200 hover:bg-pink-700 font-medium py-2 px-4 rounded-lg transition-colors">
                                        使用默认图片
                                    </button>
                                )}
                            </div>
                        </div>

                        <div>
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-2xl font-semibold text-gray-200">已锁定场景 <span className="text-base font-normal text-gray-400">(可选)</span></h2>
                                <div>
                                    <label htmlFor="locked-scene-upload" className="cursor-pointer text-sm bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white font-medium py-2 px-4 rounded-lg transition-colors">
                                        上传模板
                                    </label>
                                    <input id="locked-scene-upload" type="file" className="hidden" accept="image/*" onChange={handleLockedSceneUpload} />
                                </div>
                            </div>

                            {lockedSceneImage ? (
                                <div className="relative group">
                                    <img src={lockedSceneImage.url} alt="已锁定场景" className="rounded-lg w-full object-cover" />
                                    <button
                                        onClick={handleClearLockedScene}
                                        className="absolute top-2 right-2 bg-pink-700 text-white hover:bg-pink-600 font-bold py-2 px-4 rounded-lg transition-colors text-sm"
                                    >
                                        清除锁定
                                    </button>
                                </div>
                            ) : (
                                <div className="aspect-video w-full bg-gray-900/50 rounded-lg flex items-center justify-center border-2 border-dashed border-gray-600 text-center p-4">
                                    <p className="text-gray-500">从右侧生成结果中点击“锁定”图标，<br/>或上传您自己的模板图。</p>
                                </div>
                            )}
                        </div>

                        <fieldset disabled={isSceneSelectionDisabled} className="disabled:opacity-50 disabled:cursor-not-allowed transition-opacity">
                            <div>
                                <h2 className="text-2xl font-semibold mb-4 text-gray-200">2. 选择一个新场景</h2>
                                <SceneSelector
                                    scenes={SCENES}
                                    selectedScene={selectedScene}
                                    onSelectScene={setSelectedScene}
                                />
                                <div className="mt-4">
                                    <label htmlFor="scene-prompt" className="block text-sm font-medium text-gray-300 mb-2">场景提示词 (可编辑)</label>
                                    <textarea
                                        id="scene-prompt"
                                        value={selectedScene.prompt}
                                        onChange={handlePromptChange}
                                        rows={4}
                                        className="w-full bg-gray-700 border-gray-600 rounded-lg text-white px-4 py-2 focus:ring-pink-500 focus:border-pink-500 transition disabled:bg-gray-800"
                                    />
                                </div>
                                 {selectedScene.name === '同款多色合集' && (
                                    <div className="mt-4">
                                        <label htmlFor="color-prompt" className="block text-sm font-medium text-gray-300 mb-2">输入期望的颜色 (可选)</label>
                                        <input
                                            type="text"
                                            id="color-prompt"
                                            value={colorPrompt}
                                            onChange={(e) => setColorPrompt(e.target.value)}
                                            placeholder="例如：米白、雾霾蓝、卡其色"
                                            className="w-full bg-gray-700 border-gray-600 rounded-lg text-white px-4 py-2 focus:ring-pink-500 focus:border-pink-500 transition disabled:bg-gray-800"
                                        />
                                    </div>
                                )}
                            </div>

                            <div className="mt-6">
                                <h2 className="text-2xl font-semibold mb-4 text-gray-200">3. 选择图片比例</h2>
                                <AspectRatioSelector
                                    ratios={ASPECT_RATIOS}
                                    selectedRatio={selectedAspectRatio}
                                    onSelectRatio={setSelectedAspectRatio}
                                />
                            </div>
                        </fieldset>

                        <div className="mt-2">
                           <button
                                onClick={handleGenerate}
                                disabled={isLoading || isQueued}
                                className="w-full text-lg font-semibold text-white bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg py-4 px-6 transition-all duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-4 focus:ring-pink-500/50"
                            >
                                {getButtonText()}
                            </button>
                             <div className="mt-4 text-center bg-gray-900/50 p-3 rounded-lg border border-gray-700">
                                <p className="text-sm font-medium text-gray-200">
                                    当前剩余额度 (1分钟内): <span className={`text-lg font-bold ${getQuotaColor()}`}>{remainingQuota}</span> / {RPM_LIMIT}
                                </p>
                                <p className="text-xs text-gray-500 mt-2">
                                    请注意：API 有使用频率限制（免费版通常为 {RPM_LIMIT} 次/分钟）。额度用尽后请求将自动排队。
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Output Panel */}
                    <div className="bg-gray-800/50 rounded-2xl p-6 shadow-2xl backdrop-blur-sm border border-gray-700/50">
                         <h2 className="text-2xl font-semibold mb-4 text-gray-200">AI 生成结果</h2>
                        <div className="aspect-square w-full bg-gray-900/50 rounded-lg flex items-center justify-center border-2 border-dashed border-gray-600 overflow-hidden relative">
                           {isQueued && !isLoading && (
                                <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center text-center p-4 z-10">
                                    <p className="text-lg font-semibold">请求已加入队列</p>
                                    <p className="mt-2 text-sm text-gray-300">正在等待API额度刷新...</p>
                                    <p className="text-sm text-gray-400">(剩余 <span className={`${getQuotaColor()}`}>{remainingQuota}</span>, 需要 {REQUESTS_PER_GENERATION})</p>
                                </div>
                            )}
                           {isLoading && (
                                <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center text-center p-4 z-10">
                                    <LoadingSpinner />
                                    <p className="mt-4 text-lg font-semibold">正在生成图片...</p>
                                    <p className="text-sm text-gray-300">{loadingStep}</p>
                                </div>
                            )}
                            {error && !isLoading && (
                                <div className="text-center p-4 text-red-400">
                                    <h3 className="font-bold text-lg">生成失败</h3>
                                    <p className="text-sm">{error}</p>
                                </div>
                            )}
                            {!isLoading && !isQueued && !error && !generatedImages && (
                                <div className="text-center text-gray-500 p-4">
                                    <p>您生成的图片将显示在这里。</p>
                                </div>
                            )}
                            {generatedImages && !error && (
                               <div className="grid grid-cols-2 gap-2 w-full h-full">
                                    {generatedImages.map((src, index) => (
                                        <div key={index} className="relative group rounded-md overflow-hidden">
                                            <img src={src} alt={`Generated scene ${index + 1}`} className="w-full h-full object-cover" />
                                            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                                <button onClick={() => openModal(src)} className="text-white p-2 rounded-full bg-black/50 hover:bg-black/80" title="放大" aria-label="放大">
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" /></svg>
                                                </button>
                                                <button onClick={() => downloadImage(src, `scene-${selectedScene.name.replace(' ','-')}-${index + 1}.png`)} className="text-white p-2 rounded-full bg-black/50 hover:bg-black/80" title="下载" aria-label="下载">
                                                     <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                                                </button>
                                                <button onClick={() => handleLockScene(src)} className="text-white p-2 rounded-full bg-black/50 hover:bg-black/80" title="锁定场景" aria-label="锁定场景">
                                                    <LockIcon />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </main>
            {modalImageSrc && (
                <ImageModal 
                    src={modalImageSrc} 
                    onClose={closeModal} 
                    onDownload={() => downloadImage(modalImageSrc, `scene-${selectedScene.name.replace(' ','-')}-large.png`)}
                />
            )}
        </div>
    );
};

export default App;


import React from 'react';
import type { Scene } from '../types';

interface SceneSelectorProps {
    scenes: Scene[];
    selectedScene: Scene;
    onSelectScene: (scene: Scene) => void;
}

const SceneSelector: React.FC<SceneSelectorProps> = ({ scenes, selectedScene, onSelectScene }) => {
    return (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {scenes.map((scene) => (
                <button
                    key={scene.name}
                    onClick={() => onSelectScene(scene)}
                    className={`p-3 rounded-lg text-sm font-medium transition-all duration-200 ease-in-out focus:outline-none focus:ring-4 ${
                        selectedScene.name === scene.name
                            ? 'bg-pink-600 text-white shadow-lg ring-pink-500/50 scale-105'
                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white'
                    }`}
                >
                    {scene.name}
                </button>
            ))}
        </div>
    );
};

export default SceneSelector;

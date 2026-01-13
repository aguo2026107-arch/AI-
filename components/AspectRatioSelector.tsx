
import React from 'react';

interface AspectRatio {
    value: string;
    label: string;
}

interface AspectRatioSelectorProps {
    ratios: AspectRatio[];
    selectedRatio: string;
    onSelectRatio: (ratio: string) => void;
}

const AspectRatioSelector: React.FC<AspectRatioSelectorProps> = ({ ratios, selectedRatio, onSelectRatio }) => {
    return (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {ratios.map((ratio) => (
                <button
                    key={ratio.value}
                    onClick={() => onSelectRatio(ratio.value)}
                    className={`p-3 rounded-lg text-sm font-medium transition-all duration-200 ease-in-out focus:outline-none focus:ring-4 flex flex-col items-center justify-center gap-1 ${
                        selectedRatio === ratio.value
                            ? 'bg-pink-600 text-white shadow-lg ring-pink-500/50 scale-105'
                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white'
                    }`}
                >
                    <span>{`${ratio.label}`}</span>
                    <span className="text-xs text-gray-400">{`(${ratio.value})`}</span>
                </button>
            ))}
        </div>
    );
};

export default AspectRatioSelector;

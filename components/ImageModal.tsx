
import React from 'react';

interface ImageModalProps {
    src: string;
    onClose: () => void;
    onDownload: () => void;
}

const ImageModal: React.FC<ImageModalProps> = ({ src, onClose, onDownload }) => {
    return (
        <div 
            className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 p-4 transition-opacity duration-300" 
            onClick={onClose}
        >
            <div 
                className="relative bg-gray-900 p-2 rounded-lg shadow-2xl max-w-4xl max-h-[90vh] w-auto"
                onClick={(e) => e.stopPropagation()}
            >
                <img src={src} alt="Magnified view" className="object-contain max-h-[calc(90vh-60px)] rounded-md" />

                <button
                    onClick={onClose}
                    className="absolute -top-4 -right-4 text-white bg-gray-800 hover:bg-gray-700 rounded-full p-2 focus:outline-none focus:ring-2 focus:ring-white z-10"
                    aria-label="Close"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>

                <button
                    onClick={onDownload}
                    className="absolute bottom-4 right-4 bg-pink-600 hover:bg-pink-700 text-white font-bold py-2 px-4 rounded-lg transition-colors flex items-center gap-2"
                    aria-label="Download image"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                    下载
                </button>
            </div>
        </div>
    );
};

export default ImageModal;

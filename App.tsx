import React, { useState, useRef, useCallback } from 'react';
import { generateTranscriptFromAudio, generateSpeechFromText } from './services/geminiService';

// --- Helper Functions for Audio & File Processing ---

const fileToBase64 = (file: File): Promise<{ data: string, mimeType: string }> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      const data = result.split(',')[1];
      resolve({ data, mimeType: file.type });
    };
    reader.onerror = (error) => reject(error);
  });

// Decodes a base64 string into a Uint8Array.
const decode = (base64: string): Uint8Array => {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

// Converts raw PCM audio data into a WAV file Blob.
const createWavBlob = (pcmData: Uint8Array, sampleRate: number, numChannels: number): Blob => {
  const dataView = new DataView(new ArrayBuffer(pcmData.byteLength));
  for(let i = 0; i < pcmData.byteLength; i++){
      dataView.setUint8(i, pcmData[i]);
  }

  const pcmInt16 = new Int16Array(dataView.buffer);

  const wavHeader = new ArrayBuffer(44);
  const view = new DataView(wavHeader);
  const numSamples = pcmInt16.length;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * (bitsPerSample / 8);

  // RIFF header
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + dataSize, true);
  view.setUint32(8, 0x57415645, false); // "WAVE"
  // "fmt " sub-chunk
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true); // Sub-chunk size
  view.setUint16(20, 1, true); // Audio format (1 = PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  // "data" sub-chunk
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataSize, true);

  return new Blob([view, pcmInt16], { type: 'audio/wav' });
};


// --- SVG Icons ---

const UploadIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
  </svg>
);

const LoadingSpinner: React.FC = () => (
  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
  </svg>
);

// --- UI Components ---

interface FileUploaderProps {
  onFileSelect: (file: File) => void;
  disabled: boolean;
}

const FileUploader: React.FC<FileUploaderProps> = ({ onFileSelect, disabled }) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      onFileSelect(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onFileSelect(e.target.files[0]);
    }
  };

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={`relative flex flex-col items-center justify-center w-full max-w-lg p-8 border-2 border-dashed rounded-lg cursor-pointer transition-colors
        ${disabled ? 'bg-gray-800 border-gray-700 cursor-not-allowed' : 'bg-gray-800/50 border-gray-600 hover:bg-gray-800 hover:border-blue-500'}`}
    >
      <input
        type="file"
        ref={inputRef}
        onChange={handleChange}
        accept="audio/*"
        className="hidden"
        disabled={disabled}
      />
      <UploadIcon className="w-12 h-12 text-gray-400" />
      <p className="mt-4 text-lg text-gray-300">
        <span className="font-semibold text-blue-400">Click to upload</span> or drag and drop
      </p>
      <p className="text-sm text-gray-500">Any audio format</p>
    </div>
  );
};

const App: React.FC = () => {
  const [inputAudioFile, setInputAudioFile] = useState<File | null>(null);
  const [inputAudioUrl, setInputAudioUrl] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string>('');
  const [outputAudioUrl, setOutputAudioUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [progressMessage, setProgressMessage] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = useCallback((file: File) => {
    if (inputAudioUrl) {
      URL.revokeObjectURL(inputAudioUrl);
    }
    if (outputAudioUrl) {
        URL.revokeObjectURL(outputAudioUrl);
    }

    setInputAudioFile(file);
    const newAudioUrl = URL.createObjectURL(file);
    setInputAudioUrl(newAudioUrl);
    setTranscript('');
    setOutputAudioUrl(null);
    setError(null);
  }, [inputAudioUrl, outputAudioUrl]);


  const handleProcessAudio = async () => {
    if (!inputAudioFile) return;

    setIsLoading(true);
    setError(null);
    setTranscript('');
    setOutputAudioUrl(null);
    setProgressMessage('Reading audio file...');

    try {
      const { data: audioData, mimeType } = await fileToBase64(inputAudioFile);

      setProgressMessage('Generating transcript...');
      const generatedTranscript = await generateTranscriptFromAudio(audioData, mimeType);
      setTranscript(generatedTranscript);

      setProgressMessage('Synthesizing audio...');
      const synthesizedAudioData = await generateSpeechFromText(generatedTranscript);
      if (synthesizedAudioData) {
        setProgressMessage('Processing audio...');
        const pcmData = decode(synthesizedAudioData);
        const wavBlob = createWavBlob(pcmData, 24000, 1);
        const newAudioUrl = URL.createObjectURL(wavBlob);
        setOutputAudioUrl(newAudioUrl);
      } else {
          throw new Error('Failed to generate audio data.');
      }

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
      setError(`Processing failed: ${errorMessage}`);
      console.error(err);
    } finally {
      setIsLoading(false);
      setProgressMessage('');
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 font-sans p-4 sm:p-8">
      <div className="max-w-4xl mx-auto">
        <header className="text-center mb-10">
          <h1 className="text-4xl sm:text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
            Audio AI Voiceover
          </h1>
          <p className="mt-2 text-lg text-gray-400">
            Transcribe your audio and re-synthesize it with an AI voice.
          </p>
        </header>

        <main className="space-y-8">
          <div className="bg-gray-800/40 p-6 rounded-2xl shadow-lg border border-gray-700">
            <h2 className="text-2xl font-semibold mb-4 text-blue-300">1. Upload Your Audio</h2>
            <div className="flex justify-center">
              <FileUploader onFileSelect={handleFileChange} disabled={isLoading} />
            </div>
          </div>

          {inputAudioUrl && (
            <div className="bg-gray-800/40 p-6 rounded-2xl shadow-lg border border-gray-700">
              <h2 className="text-2xl font-semibold mb-4 text-blue-300">2. Preview & Process</h2>
              <div className="flex flex-col gap-6 items-center">
                <div>
                    <h3 className="text-lg font-medium text-gray-300 mb-2 text-center">Your Uploaded Audio</h3>
                    <audio controls src={inputAudioUrl} className="w-full max-w-md rounded-lg shadow-md border border-gray-600" />
                </div>
                <div className="flex flex-col items-center">
                    <button
                        onClick={handleProcessAudio}
                        disabled={isLoading}
                        className="w-full max-w-xs bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-lg transition-transform transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 flex items-center justify-center text-lg"
                    >
                        {isLoading ? <LoadingSpinner /> : 'Transcribe & Synthesize'}
                    </button>
                    {isLoading && <p className="mt-4 text-gray-300 animate-pulse">{progressMessage}</p>}
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-900/50 border border-red-700 text-red-200 px-4 py-3 rounded-lg" role="alert">
                <strong className="font-bold">Error: </strong>
                <span className="block sm:inline">{error}</span>
            </div>
          )}
          
          {(transcript || outputAudioUrl) && !isLoading && (
             <div className="bg-gray-800/40 p-6 rounded-2xl shadow-lg border border-gray-700">
                <h2 className="text-2xl font-semibold mb-4 text-blue-300">3. Results</h2>
                <div className="space-y-6">
                    <div>
                        <h3 className="text-xl font-medium text-gray-300 mb-2">Generated Transcript</h3>
                        <p className="bg-gray-900/70 p-4 rounded-lg text-gray-200 italic border border-gray-700">"{transcript}"</p>
                    </div>
                    {outputAudioUrl && (
                        <div>
                            <h3 className="text-xl font-medium text-gray-300 mb-2">Synthesized Audio</h3>
                            <audio controls src={outputAudioUrl} className="w-full">
                                Your browser does not support the audio element.
                            </audio>
                        </div>
                    )}
                </div>
             </div>
          )}

        </main>
      </div>
    </div>
  );
};

export default App;
import { GoogleGenAI, Modality } from "@google/genai";

const getGenAI = () => {
  if (!process.env.API_KEY) {
    throw new Error("API_KEY environment variable not set");
  }
  return new GoogleGenAI({ apiKey: process.env.API_KEY });
};

export const generateTranscriptFromAudio = async (base64AudioData: string, mimeType: string): Promise<string> => {
  const ai = getGenAI();
  const audioPart = {
    inlineData: {
      mimeType,
      data: base64AudioData,
    },
  };

  const textPart = {
    text: `Please provide a clean, accurate transcription of the following audio.`,
  };

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: { parts: [audioPart, textPart] },
  });

  return response.text;
};

export const generateSpeechFromText = async (text: string): Promise<string | undefined> => {
  const ai = getGenAI();
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-preview-tts',
    contents: [{ parts: [{ text: `Please say the following: ${text}` }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Kore' },
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  return base64Audio;
};
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { 
  Mic, 
  MicOff, 
  Volume2, 
  Sparkles, 
  Camera, 
  CameraOff, 
  ChevronRight, 
  RotateCcw,
  Settings,
  MessageSquare,
  Trophy,
  Save,
  Key
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Initialize Gemini AI
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

interface Message {
  role: 'user' | 'model';
  it: string;
  nl: string;
  ph?: string;
  score?: number;
  heard?: string;
}

export default function App() {
  const [isCamOn, setIsCamOn] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [level, setLevel] = useState('A2');
  const [topic, setTopic] = useState('dagelijks leven');
  const [score, setScore] = useState(0);
  const [status, setStatus] = useState('Klaar · Klik ✨ om te starten');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [customKey, setCustomKey] = useState(localStorage.getItem('specchio_api_key') || '');

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Initialize Gemini AI with fallback to custom key
  const getAI = () => {
    const key = customKey || process.env.GEMINI_API_KEY || "";
    return new GoogleGenAI({ apiKey: key });
  };

  // Save custom key
  const saveCustomKey = (key: string) => {
    localStorage.setItem('specchio_api_key', key);
    setCustomKey(key);
    setShowKeyModal(false);
    setStatus('API Key opgeslagen!');
  };

  // Auto-scroll chat only when messages length changes
  const prevMessagesLength = useRef(0);
  useEffect(() => {
    if (messages.length > prevMessagesLength.current || isThinking) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    prevMessagesLength.current = messages.length;
  }, [messages.length, isThinking]);

  // Camera Toggle
  const toggleCam = async () => {
    if (isCamOn) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      setIsCamOn(false);
      setStatus('Spiegel uit.');
    } else {
      try {
        setStatus('Camera opstarten...');
        
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error("Browser ondersteunt geen camera.");
        }

        // Use very basic constraints for maximum compatibility
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: true, 
          audio: false 
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          // Use a small delay to ensure the stream is ready
          setTimeout(() => {
            videoRef.current?.play().catch(e => console.error("Play error:", e));
          }, 100);
        }
        
        streamRef.current = stream;
        setIsCamOn(true);
        setStatus('Spiegel actief! ✨');
      } catch (err: any) {
        console.error("Camera error:", err);
        let msg = 'Camera fout';
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          msg = 'Toegang geweigerd. Open de app in een nieuw tabblad.';
        } else {
          msg = `Fout: ${err.name || 'onbekend'}`;
        }
        setStatus(msg);
        setIsCamOn(false);
      }
    }
  };

  // Gemini TTS (Text-to-Speech)
  const speakIt = async (text: string) => {
    if (!text) return;
    setIsSpeaking(true);
    setStatus('De spiegel spreekt... · Lo specchio parla...');

    try {
      const aiInstance = getAI();
      const response = await aiInstance.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: `Say clearly in Italian: ${text}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' }, // Warm female voice
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        
        // Gemini TTS returns raw PCM (16-bit, mono, 24000Hz)
        const binaryString = atob(base64Audio);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        
        // Convert 16-bit PCM to Float32 for Web Audio API
        const int16Data = new Int16Array(bytes.buffer);
        const float32Data = new Float32Array(int16Data.length);
        for (let i = 0; i < int16Data.length; i++) {
          float32Data[i] = int16Data[i] / 32768.0;
        }

        const audioBuffer = audioContextRef.current.createBuffer(1, float32Data.length, 24000);
        audioBuffer.getChannelData(0).set(float32Data);

        const source = audioContextRef.current.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContextRef.current.destination);
        source.onended = () => {
          setIsSpeaking(false);
          setStatus('Druk 🎤 om te antwoorden');
        };
        source.start();
      } else {
        throw new Error("No audio data received");
      }
    } catch (err) {
      console.error("TTS error:", err);
      // Fallback to browser TTS
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'it-IT';
      utterance.rate = 0.85;
      utterance.onend = () => setIsSpeaking(false);
      window.speechSynthesis.speak(utterance);
      setStatus('Browser-stem gebruikt (fallback)');
    }
  };

  // Speech Recognition
  const startRecording = () => {
    try {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognition) {
        setStatus('Spraakherkenning niet ondersteund in deze browser.');
        return;
      }

      if (window.speechSynthesis) window.speechSynthesis.cancel();
      
      // Clean up old instance if exists
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch(e) {}
      }

      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.lang = 'it-IT';
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;

      recognitionRef.current.onstart = () => {
        setIsRecording(true);
        setStatus('Ik luister... Spreek nu Italiaans.');
      };

      recognitionRef.current.onresult = (event: any) => {
        const heard = event.results[0][0].transcript;
        setIsRecording(false);
        processHeard(heard);
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error("Speech error:", event.error);
        setIsRecording(false);
        if (event.error === 'not-allowed') {
          setStatus('Microfoon geblokkeerd. Check je browser-instellingen.');
        } else if (event.error === 'no-speech') {
          setStatus('Niets gehoord. Probeer het nog eens.');
        } else {
          setStatus(`Microfoon fout: ${event.error}`);
        }
      };

      recognitionRef.current.onend = () => {
        setIsRecording(false);
      };

      recognitionRef.current.start();
    } catch (err: any) {
      console.error("Recognition start error:", err);
      setStatus('Kon microfoon niet starten.');
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    recognitionRef.current?.stop();
    setIsRecording(false);
  };

  // Process User Input
  const processHeard = async (heard: string) => {
    if (!heard.trim()) return;

    // Simple score calculation (Levenshtein would be better, but let's keep it simple for now)
    const lastModelMsg = messages.filter(m => m.role === 'model').pop();
    let currentScore = 0;
    let feedback = '';

    if (lastModelMsg) {
      const similarity = calculateSimilarity(lastModelMsg.it, heard);
      if (similarity > 0.7) {
        currentScore = 2;
        feedback = 'Bravo!';
      } else if (similarity > 0.4) {
        currentScore = 1;
        feedback = 'Quasi!';
      } else {
        feedback = 'Riprova';
      }
      setScore(prev => prev + currentScore);
    }

    const userMsg: Message = {
      role: 'user',
      it: heard,
      nl: '',
      heard: heard,
      score: currentScore
    };

    setMessages(prev => [...prev, userMsg]);
    generateAIResponse([...messages, userMsg]);
  };

  const calculateSimilarity = (s1: string, s2: string) => {
    const a = s1.toLowerCase().replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, "");
    const b = s2.toLowerCase().replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, "");
    if (a === b) return 1;
    if (a.includes(b) || b.includes(a)) return 0.8;
    return 0.5; // Placeholder
  };

  // AI Response Generation
  const generateAIResponse = async (history: Message[]) => {
    setIsThinking(true);
    setStatus('De spiegel denkt na... · Lo specchio pensa...');

    const systemPrompt = `You are a warm, spontaneous Italian conversation partner — like a magic mirror that speaks. 
    Level: ${level}. Current Topic: ${topic}.
    RULES:
    1. ONE short Italian sentence or question per turn (max 12 words).
    2. Always end with a question or statement that invites a response.
    3. React naturally to what the human said.
    4. RESPOND ONLY with valid JSON: {"it":"Italian sentence","nl":"Dutch translation","ph":"phonetic e.g. KO-me STAI"}`;

    const contents = history.map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.role === 'user' ? m.it : JSON.stringify({ it: m.it, nl: m.nl, ph: m.ph }) }]
    }));

    try {
      const aiInstance = getAI();
      const response = await aiInstance.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: contents.length > 0 ? contents : [{ role: 'user', parts: [{ text: 'Start de conversatie.' }] }],
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: "application/json",
        },
      });

      const data = JSON.parse(response.text || "{}");
      const aiMsg: Message = {
        role: 'model',
        it: data.it || "Ciao!",
        nl: data.nl || "Hallo!",
        ph: data.ph || ""
      };

      setMessages(prev => [...prev, aiMsg]);
      setIsThinking(false);
      speakIt(aiMsg.it);
    } catch (err) {
      console.error("AI Error:", err);
      setIsThinking(false);
      setStatus('Oeps, de spiegel is even wazig.');
    }
  };

  const startNewConversation = () => {
    setMessages([]);
    setScore(0);
    generateAIResponse([]);
  };

  const downloadTranscript = () => {
    if (messages.length === 0) return;
    
    const transcript = messages.map(m => {
      const role = m.role === 'user' ? 'JIJ' : 'SPIEGEL';
      return `[${role}]\nIT: ${m.it}\nNL: ${m.nl || '-'}\n`;
    }).join('\n---\n\n');

    const blob = new Blob([transcript], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `specchio-magico-gesprek-${new Date().toLocaleDateString()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setStatus('Gesprek opgeslagen als .txt');
  };

  // --- HIER BEGINT DE NIEUWE LAY-OUT (100dvh en flex-col) ---
  return (
    <div className="h-[100dvh] w-full bg-[#080810] text-[#f5f0e8] font-sans selection:bg-[#c9a84c]/30 overflow-hidden flex flex-col">
      <div className="flex flex-col h-full max-w-md mx-auto w-full px-4 pt-3 pb-2 relative z-10">
        
        {/* 1. Header (Kleiner gemaakt om ruimte te besparen) */}
        <header className="text-center pb-3 shrink-0">
          <motion.h1 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="font-serif text-3xl font-light tracking-widest text-[#e8c97a] drop-shadow-[0_0_20px_rgba(201,168,76,0.3)]"
          >
            Specchio
          </motion.h1>
          <p className="text-[0.6rem] tracking-[0.2em] uppercase text-[#c9a84c]/50 mt-1">
            Jouw Italiaanse partner
          </p>
        </header>

        {/* 2. Mirror Section (Past zich nu aan het scherm aan, rolt niet weg) */}
        <div className="relative mx-auto h-[28vh] min-h-[160px] max-h-[220px] aspect-[3/4] mb-3 shrink-0">
          <div className="absolute inset-0 bg-gradient-to-br from-[#7a5810] via-[#c9a84c] to-[#5a3e08] rounded-[50%_50%_46%_46%_/_28%_28%_72%_72%] p-1.5 shadow-[0_10px_30px_rgba(0,0,0,0.8)]">
            <div className="w-full h-full bg-[#111128] rounded-[47%_47%_44%_44%_/_26%_26%_74%_74%] overflow-hidden relative">
              <video 
                ref={videoRef}
                autoPlay 
                playsInline 
                muted 
                className={`w-full h-full object-cover scale-x-[-1] transition-opacity duration-1000 ${isCamOn ? 'opacity-100' : 'opacity-0'}`}
              />
              
              <AnimatePresence>
                {!isCamOn && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 flex flex-col items-center justify-center text-center p-4 bg-radial-at-center from-[#161630] to-[#080810]"
                  >
                    <Sparkles className="w-8 h-8 text-[#c9a84c] mb-2 animate-pulse" />
                    <small className="text-[#c9a84c]/60 text-[0.6rem] uppercase tracking-wider leading-relaxed">Spiegel is uit</small>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="absolute inset-0 pointer-events-none bg-gradient-to-br from-transparent via-[#c9a84c]/5 to-transparent animate-[shimmer_8s_infinite]" />
            </div>
          </div>
          
          <button 
            type="button"
            onClick={(e) => { e.preventDefault(); toggleCam(); }}
            className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-[#080810] border border-[#c9a84c]/30 px-3 py-1 rounded-full text-[0.6rem] tracking-widest uppercase text-[#c9a84c]/80 hover:border-[#c9a84c] hover:text-[#c9a84c] transition-all flex items-center gap-1.5 whitespace-nowrap z-20"
          >
            {isCamOn ? <CameraOff size={10} /> : <Camera size={10} />}
            {isCamOn ? 'Stop Spiegel' : 'Start Spiegel'}
          </button>
        </div>

        {/* 3. Settings Row (Compact, direct onder de spiegel) */}
        <div className="grid grid-cols-2 gap-2 mb-3 shrink-0">
          <div className="space-y-1">
            <label className="text-[0.55rem] uppercase tracking-widest text-[#c9a84c]/50 ml-1 flex items-center gap-1">
              <Settings size={8} /> Niveau
            </label>
            <select 
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              className="w-full bg-[#c9a84c]/5 border border-[#c9a84c]/20 rounded-lg px-2 py-1.5 text-[0.7rem] outline-none focus:border-[#c9a84c]/40 transition-colors"
            >
              <option value="A1">A1 - Beginner</option>
              <option value="A2">A2 - Elementair</option>
              <option value="B1">B1 - Gevorderd</option>
              <option value="B2">B2 - Vloeiend</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[0.55rem] uppercase tracking-widest text-[#c9a84c]/50 ml-1 flex items-center gap-1">
              <MessageSquare size={8} /> Onderwerp
            </label>
            <select 
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              className="w-full bg-[#c9a84c]/5 border border-[#c9a84c]/20 rounded-lg px-2 py-1.5 text-[0.7rem] outline-none focus:border-[#c9a84c]/40 transition-colors"
            >
              <option value="dagelijks leven">Dagelijks Leven</option>
              <option value="restaurant">Restaurant</option>
              <option value="reizen">Reizen</option>
              <option value="familie">Familie</option>
              <option value="werk">Werk</option>
            </select>
          </div>
        </div>

        {/* 4. Action Row (Microfoon & Knoppen BOVEN de chat) */}
        <div className="flex items-center justify-center gap-6 mb-2 shrink-0">
          <div className="flex flex-col items-center gap-1">
            <button 
              type="button"
              onClick={() => messages.length > 0 && speakIt(messages[messages.length-1].it)}
              className="w-10 h-10 rounded-full bg-[#c9a84c]/10 border border-[#c9a84c]/20 flex items-center justify-center text-[#c9a84c] hover:bg-[#c9a84c]/20 transition-all"
            >
              <Volume2 size={16} />
            </button>
            <span className="text-[0.55rem] uppercase tracking-widest text-[#c9a84c]/60">Herhoor</span>
          </div>

          <div className="flex flex-col items-center gap-1">
            <button 
              type="button"
              onClick={isRecording ? stopRecording : startRecording}
              className={`w-16 h-16 rounded-full flex items-center justify-center transition-all shadow-xl ${
                isRecording 
                  ? 'bg-red-500/20 border-2 border-red-500 animate-pulse' 
                  : 'bg-gradient-to-br from-[#c9a84c] to-[#8b6010] shadow-[#c9a84c]/20'
              }`}
            >
              {isRecording ? <MicOff size={24} className="text-red-500" /> : <Mic size={24} className="text-[#080810]" />}
            </button>
            <span className={`text-[0.6rem] uppercase tracking-widest font-bold ${isRecording ? 'text-red-500' : 'text-[#c9a84c]'}`}>
              {isRecording ? 'Luisteren...' : 'Antwoorden'}
            </span>
          </div>

          <div className="flex flex-col items-center gap-1">
            <button 
              type="button"
              onClick={() => generateAIResponse(messages)}
              className="w-10 h-10 rounded-full bg-[#c9a84c]/10 border border-[#c9a84c]/20 flex items-center justify-center text-[#c9a84c] hover:bg-[#c9a84c]/20 transition-all"
            >
              <ChevronRight size={16} />
            </button>
            <span className="text-[0.55rem] uppercase tracking-widest text-[#c9a84c]/60">Sla over</span>
          </div>
        </div>

        {/* Status Text just above chat */}
        <div className="text-center shrink-0 mb-2">
          <p className="text-[0.65rem] text-[#c9a84c]/60 min-h-[1em] italic font-medium">{status}</p>
        </div>

        {/* 5. Chat Area (Neemt rest van het scherm in, scrolt zelfstandig) */}
        <div className="flex-1 min-h-0 bg-black/30 border border-[#c9a84c]/10 rounded-xl overflow-y-auto p-3 space-y-3 scrollbar-thin scrollbar-thumb-[#c9a84c]/20">
          {messages.map((msg, i) => (
            <motion.div 
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
            >
              <div className={`max-w-[90%] px-3 py-2 rounded-xl text-[0.8rem] leading-relaxed ${
                msg.role === 'user' 
                  ? 'bg-white/5 border border-white/10 rounded-br-none italic text-white/80' 
                  : 'bg-gradient-to-br from-[#c9a84c]/10 to-[#c9a84c]/5 border border-[#c9a84c]/20 rounded-bl-none'
              }`}>
                {msg.role === 'model' ? (
                  <>
                    <span className="font-serif italic text-base text-[#e8c97a] block mb-0.5">{msg.it}</span>
                    <span className="text-[0.65rem] text-white/40 block leading-tight">{msg.nl}</span>
                    {msg.ph && <span className="text-[0.6rem] text-[#c9a84c]/50 italic block mt-1">/{msg.ph}/</span>}
                  </>
                ) : (
                  <>
                    <span>{msg.it}</span>
                    {msg.score !== undefined && (
                      <div className={`mt-1.5 text-[0.55rem] font-bold uppercase px-1.5 py-0.5 rounded-sm inline-block ${
                        msg.score === 2 ? 'bg-green-500/10 text-green-400 border border-green-500/20' :
                        msg.score === 1 ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20' :
                        'bg-red-500/10 text-red-400 border border-red-500/20'
                      }`}>
                        {msg.score === 2 ? '✓ Bravo!' : msg.score === 1 ? '~ Quasi!' : '↻ Riprova'}
                      </div>
                    )}
                  </>
                )}
              </div>
            </motion.div>
          ))}
          {isThinking && (
            <div className="flex gap-1.5 p-2 bg-[#c9a84c]/5 border border-[#c9a84c]/10 rounded-xl rounded-bl-none w-12">
              <div className="w-1 h-1 bg-[#c9a84c] rounded-full animate-bounce" />
              <div className="w-1 h-1 bg-[#c9a84c] rounded-full animate-bounce [animation-delay:0.2s]" />
              <div className="w-1 h-1 bg-[#c9a84c] rounded-full animate-bounce [animation-delay:0.4s]" />
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* 6. Footer (Zeer compact rijtje voor score en overige knopjes) */}
        <div className="shrink-0 flex items-center justify-between mt-2 pt-2 border-t border-[#c9a84c]/10">
          <div className="flex items-center gap-1.5 text-[#c9a84c] font-bold text-sm bg-[#c9a84c]/10 px-3 py-1 rounded-full border border-[#c9a84c]/20">
            <Trophy size={14} /> {score}
          </div>
          
          <div className="flex gap-1.5">
            <button 
              type="button"
              onClick={startNewConversation}
              className="p-1.5 bg-[#c9a84c]/5 border border-[#c9a84c]/10 rounded-md text-[#c9a84c]/60 hover:bg-[#c9a84c]/20 hover:text-[#c9a84c] transition-all flex items-center gap-1"
              title="Nieuw Gesprek"
            >
              <RotateCcw size={14} />
              <span className="text-[0.6rem] uppercase tracking-wider hidden sm:inline">Nieuw</span>
            </button>
            <button 
              type="button"
              onClick={downloadTranscript}
              className="p-1.5 bg-[#c9a84c]/5 border border-[#c9a84c]/10 rounded-md text-[#c9a84c]/60 hover:bg-[#c9a84c]/20 hover:text-[#c9a84c] transition-all"
              title="Opslaan als tekst"
            >
              <Save size={14} />
            </button>
            <button 
              type="button"
              onClick={() => setShowKeyModal(true)}
              className="p-1.5 bg-[#c9a84c]/5 border border-[#c9a84c]/10 rounded-md text-[#c9a84c]/60 hover:bg-[#c9a84c]/20 hover:text-[#c9a84c] transition-all"
              title="API Key"
            >
              <Key size={14} />
            </button>
          </div>
        </div>

      </div>

      {/* Key Modal (Blijft hetzelfde) */}
      <AnimatePresence>
        {showKeyModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-[#12122a] border border-[#c9a84c]/30 p-6 rounded-2xl w-full max-w-xs shadow-2xl"
            >
              <h2 className="font-serif text-xl text-[#e8c97a] mb-2 text-center">Gemini API Key</h2>
              <p className="text-[0.65rem] text-[#c9a84c]/50 mb-4 text-center leading-relaxed">
                Gebruik je eigen key voor maximale privacy.<br/>Opgeslagen in je browser.
              </p>
              <input 
                type="password"
                defaultValue={customKey}
                id="keyInput"
                placeholder="Plak je API key hier..."
                className="w-full bg-black/40 border border-[#c9a84c]/20 rounded-lg px-4 py-2.5 text-sm mb-4 outline-none focus:border-[#c9a84c]/50"
              />
              <div className="flex gap-2">
                <button 
                  onClick={() => setShowKeyModal(false)}
                  className="flex-1 py-2 text-xs text-[#c9a84c]/50 border border-transparent hover:border-[#c9a84c]/20 rounded-lg"
                >
                  Annuleren
                </button>
                <button 
                  onClick={() => {
                    const val = (document.getElementById('keyInput') as HTMLInputElement).value;
                    saveCustomKey(val);
                  }}
                  className="flex-1 py-2 bg-gradient-to-r from-[#c9a84c] to-[#8b6010] rounded-lg text-[#080810] text-xs font-bold"
                >
                  Opslaan
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Decorative Background Elements */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-[#c9a84c]/5 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-[#503cb4]/5 blur-[120px] rounded-full" />
      </div>
    </div>
  );
}

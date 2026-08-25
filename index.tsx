
import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, Modality } from '@google/genai';

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

const loadingSteps = [
  "Initializing Veo 3.1 model",
  "Analyzing inputs & vectors",
  "Synthesizing motion",
  "Rendering video frames",
  "Applying cinematic lighting",
  "Finalizing output",
];

interface HistoryItem {
  prompt: string;
  videoUrl: string;
  timestamp: number;
  config: string;
}

const AVAILABLE_MODELS = [
  { id: 'veo-3.1-fast-generate-preview', name: 'Veo 3.1 Fast', description: 'Optimized for speed and quick previews.' },
  { id: 'veo-3.1-generate-preview', name: 'Veo 3.1 High Quality', description: 'Highest fidelity and cinematic detail.' }
];

// Audio Decoding Helpers for TTS
function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext() {
  if (!sharedAudioCtx) {
    sharedAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
  }
  return sharedAudioCtx;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

const VideoGeneratorApp = () => {
  // --- State ---
  
  // Inputs
  const [prompt, setPrompt] = useState<string>('');
  const [startFrame, setStartFrame] = useState<File | null>(null);
  const [startFrameBase64, setStartFrameBase64] = useState<string | null>(null);
  const [endFrame, setEndFrame] = useState<File | null>(null);
  const [endFrameBase64, setEndFrameBase64] = useState<string | null>(null);

  // Configuration
  const [selectedModel, setSelectedModel] = useState(AVAILABLE_MODELS[0]);
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [resolution, setResolution] = useState<'720p' | '1080p'>('720p');
  const [duration, setDuration] = useState<number>(8);

  // App Status
  const [loading, setLoading] = useState<boolean>(false);
  const [ttsLoading, setTtsLoading] = useState<boolean>(false);
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'canvas' | 'generations'>('canvas');
  
  // Data
  const [history, setHistory] = useState<HistoryItem[]>([]);
  
  // Auth & System
  const [apiKeySelected, setApiKeySelected] = useState<boolean>(false);
  const [isPricingOpen, setIsPricingOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');

  // Refs
  const modelDropdownRef = useRef<HTMLDivElement>(null);

  // Pricing State
  const [pricingTab, setPricingTab] = useState<'subscribe' | 'topup'>('subscribe');
  const [activePlanIndex, setActivePlanIndex] = useState(1);
  const [activePackIndex, setActivePackIndex] = useState(1);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');

  const plans = [
    {
        name: "Starter Plan",
        subheading: "Great for Hobbyists, students, casual creators.",
        description: "Perfect entry point for experimenting.",
        price: { monthly: 5, yearly: 45 },
        features: [
            "Standard HD output",
            "AES-256 data encryption",
            "Community support"
        ]
    },
    {
        name: "Pro Plan",
        subheading: "Great for Freelancers, small studios, content creators.",
        description: "The sweet spot for independent creators.",
        price: { monthly: 25, yearly: 225 },
        features: [
            "Priority rendering queue",
            "Access to advanced editing tools",
            "Standard Security SLA",
            "SOC2 readiness report access"
        ]
    },
    {
        name: "Enterprise Plan",
        subheading: "Great for Agencies, businesses, developers.",
        description: "Power your platform with scalable AI video generation.",
        price: { monthly: 99, yearly: 891 },
        features: [
            "99.99% Uptime Security SLA",
            "Dedicated support (1h Security Response)",
            "SOC2 Type II & GDPR Compliance",
            "SSO / SAML & SCIM provisioning",
            "Custom Data Residency controls"
        ]
    }
  ];

  const creditPacks = [
      { credits: 600, price: 5, label: "Starter Pack" },
      { credits: 1500, price: 12, label: "Creator Pack" },
      { credits: 3000, price: 25, label: "Pro Pack" },
      { credits: 10000, price: 75, label: "Studio Pack" },
      { credits: 30000, price: 99, label: "Enterprise Pack" }
  ];

  const currentPlan = plans[activePlanIndex];
  const currentPack = creditPacks[activePackIndex];

  // --- Derived State ---
  const estimatedCost = resolution === '720p' ? 100 : 150;

  // --- Effects ---

  useEffect(() => {
    const checkApiKey = async () => {
      if (window.aistudio && await window.aistudio.hasSelectedApiKey()) {
        setApiKeySelected(true);
      }
    };
    checkApiKey();

    // Close dropdown on outside click
    const handleClickOutside = (event: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(event.target as Node)) {
        setIsModelDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Auto-scroll to result on mobile when videoUrl changes
  useEffect(() => {
    if (videoUrl && window.innerWidth <= 768) {
      // requestAnimationFrame ensures we scroll after the next paint for smoothness
      requestAnimationFrame(() => {
          setTimeout(() => {
            const videoElement = document.querySelector('.video-wrapper');
            if (videoElement) {
                videoElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }, 150);
      });
    }
  }, [videoUrl]);

  // --- Handlers ---

  const handleSelectKey = async () => {
    if (window.aistudio) {
      await window.aistudio.openSelectKey();
      setApiKeySelected(true);
    }
  };

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result.split(',')[1]);
        } else {
          reject('Failed to convert blob to base64');
        }
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>, type: 'start' | 'end') => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      const base64 = await blobToBase64(file);
      if (type === 'start') {
        setStartFrame(file);
        setStartFrameBase64(base64);
      } else {
        setEndFrame(file);
        setEndFrameBase64(base64);
      }
      setError('');
    }
  };

  const removeFile = (type: 'start' | 'end') => {
    if (type === 'start') {
      setStartFrame(null);
      setStartFrameBase64(null);
    } else {
      setEndFrame(null);
      setEndFrameBase64(null);
    }
  };

  const handleTTS = async () => {
    if (!prompt) return;
    setTtsLoading(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: prompt }] }],
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
      if (base64Audio) {
          const audioCtx = getAudioContext();
          const decodedBytes = decode(base64Audio);
          const audioBuffer = await decodeAudioData(decodedBytes, audioCtx, 24000, 1);
          const source = audioCtx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(audioCtx.destination);
          source.start();
      }
    } catch (err: any) {
      console.error("TTS Error:", err);
      setError("Text-to-speech failed. Please try again.");
    } finally {
      setTtsLoading(false);
    }
  };

  const generateVideo = async () => {
    if (!apiKeySelected) {
      setError("Please connect your Vertex AI API Key.");
      return;
    }
    if (!prompt && !startFrame) {
      setError("Please enter a prompt or upload a start frame.");
      return;
    }

    setLoading(true);
    setCurrentStep(0);
    setError('');
    setActiveTab('canvas');
    setVideoUrl(null);
    
    // Cycle steps simulation
    let stepIdx = 0;
    const stepInterval = setInterval(() => {
        stepIdx++;
        if (stepIdx < loadingSteps.length) {
            setCurrentStep(stepIdx);
        }
    }, 4500); // Slower interval to match typical generation time

    try {
      // Create a new instance right before use to ensure the latest API key is used
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const config: any = {
        numberOfVideos: 1,
        resolution: resolution,
        aspectRatio: aspectRatio,
      };

      // Handle End Frame (lastFrame)
      if (endFrameBase64 && endFrame) {
        config.lastFrame = {
            imageBytes: endFrameBase64,
            mimeType: endFrame.type,
        };
      }

      const payload: any = {
        model: selectedModel.id,
        prompt: prompt || "A high quality video", // Fallback if user only provides image
        config: config
      };

      // Handle Start Frame (image)
      if (startFrameBase64 && startFrame) {
        payload.image = {
            imageBytes: startFrameBase64,
            mimeType: startFrame.type,
        };
      }

      let operation = await ai.models.generateVideos(payload);

      while (!operation.done) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        operation = await ai.operations.getVideosOperation({ operation });
      }

      const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
      if (downloadLink) {
        const response = await fetch(`${downloadLink}&key=${process.env.API_KEY}`);
        const videoBlob = await response.blob();
        const url = URL.createObjectURL(videoBlob);
        
        // Force complete step visual
        setCurrentStep(loadingSteps.length - 1);
        
        setVideoUrl(url);
        setHistory(prev => [{
            prompt: prompt || (startFrame ? "Image to Video" : "Generated Video"),
            videoUrl: url,
            timestamp: Date.now(),
            config: `${resolution} • ${aspectRatio} • ${duration}s`
        }, ...prev]);

      } else {
        throw new Error("Video generation completed, but no download link was found.");
      }

    } catch (e: any) {
      console.error(e);
      let errorMessage = 'An unexpected error occurred.';
      if (e.message) {
        errorMessage = e.message;
      }
      if (errorMessage.includes("Requested entity was not found")) {
          errorMessage = "Your API key is invalid or lacks Vertex AI access.";
          setApiKeySelected(false);
      }
      setError(errorMessage);
    } finally {
      clearInterval(stepInterval);
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (!videoUrl) return;
    const a = document.createElement('a');
    a.href = videoUrl;
    a.download = `veo_gen_${Date.now()}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Pricing Navigation
  const nextPlan = () => setActivePlanIndex((prev) => (prev + 1) % plans.length);
  const prevPlan = () => setActivePlanIndex((prev) => (prev - 1 + plans.length) % plans.length);
  
  const nextPack = () => setActivePackIndex((prev) => (prev + 1) % creditPacks.length);
  const prevPack = () => setActivePackIndex((prev) => (prev - 1 + creditPacks.length) % creditPacks.length);

  // --- Render Components ---

  const renderIconSidebar = () => (
    <div className="icon-sidebar">
      <div className="sidebar-logo-container" style={{ marginBottom: 20 }}>
         <svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M12 2L2 7l10 5 10-5-10-5zm0 9l2.5-1.25L12 8.5 9.5 9.75 12 11zm0 2.5l-5-2.5-5 2.5 10 5 10-5-5-2.5-5 2.5z"/></svg>
      </div>
      <button 
        className={`icon-btn ${activeTab === 'canvas' ? 'active' : ''}`}
        onClick={() => setActiveTab('canvas')}
        title="Create"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
      </button>
      <button 
        className={`icon-btn ${activeTab === 'generations' ? 'active' : ''}`} 
        onClick={() => setActiveTab('generations')}
        title="Library"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
      </button>
      <div className="spacer"></div>
      <button className="icon-btn" onClick={() => setIsPricingOpen(true)} title="Pricing">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <path d="M12 8v8" />
            <path d="M16 10a2 2 0 0 0-2-2h-2a2 2 0 1 0 0 4h2a2 2 0 1 1 0 4h-2a2 2 0 0 1-2-2" />
        </svg>
      </button>
      <button className="icon-btn" onClick={() => setIsProfileOpen(true)}>
         <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'linear-gradient(45deg, #4f46e5, #9333ea)' }}></div>
      </button>
    </div>
  );

  const renderConfigPanel = () => (
    <div className="config-panel">
      <div className="panel-header">
        <div className="panel-title-row">
            <h1>Video</h1>
            <div className="model-dropdown-container" ref={modelDropdownRef}>
              <div 
                className={`model-selector ${isModelDropdownOpen ? 'active' : ''}`}
                onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
              >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><polygon points="10 8 16 12 10 16 10 8"></polygon></svg>
                  {selectedModel.name}
                  <svg 
                    width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    style={{ transform: isModelDropdownOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
                  >
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
              </div>

              {isModelDropdownOpen && (
                <div className="model-dropdown-menu">
                  {AVAILABLE_MODELS.map((model) => (
                    <div 
                      key={model.id} 
                      className={`model-dropdown-item ${selectedModel.id === model.id ? 'selected' : ''}`}
                      onClick={() => {
                        setSelectedModel(model);
                        setIsModelDropdownOpen(false);
                      }}
                    >
                      <div className="model-item-name">{model.name}</div>
                      <div className="model-item-desc">{model.description}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
        </div>
        <p className="panel-description">
            {selectedModel.description}
        </p>
      </div>

      <div className="config-content">
        <div>
            <label className="section-label">Prompt</label>
            <div className="prompt-container">
                <textarea 
                    className="prompt-textarea" 
                    placeholder="Describe your video..." 
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                />
                <button 
                    className="tts-btn" 
                    onClick={handleTTS} 
                    disabled={!prompt || ttsLoading}
                    title="Read aloud"
                >
                    {ttsLoading ? <div className="mini-spinner" style={{ width: 14, height: 14 }}></div> : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M11 5L6 9H2v6h4l5 4V5z"></path>
                            <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                        </svg>
                    )}
                </button>
            </div>
        </div>

        <div>
             <label className="section-label">Source Images</label>
             <div className="media-inputs-grid">
                {/* Start Frame */}
                {!startFrame ? (
                    <label className="media-upload-box">
                        <input type="file" accept="image/*" hidden onChange={(e) => handleFileChange(e, 'start')} />
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                        <span>Start Frame</span>
                    </label>
                ) : (
                    <div className="media-upload-box" style={{ cursor: 'default' }}>
                         <img src={`data:${startFrame.type};base64,${startFrameBase64}`} className="preview-thumb" alt="Start" />
                         <button className="remove-media-btn" onClick={() => removeFile('start')}>&times;</button>
                         <span style={{ position: 'absolute', bottom: 8, background: 'rgba(0,0,0,0.7)', padding: '2px 6px', borderRadius: 4, fontSize: 10, zIndex: 5 }}>Start</span>
                    </div>
                )}

                {/* End Frame */}
                {!endFrame ? (
                    <label className="media-upload-box">
                        <input type="file" accept="image/*" hidden onChange={(e) => handleFileChange(e, 'end')} />
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                        <span>End Frame</span>
                    </label>
                ) : (
                    <div className="media-upload-box" style={{ cursor: 'default' }}>
                         <img src={`data:${endFrame.type};base64,${endFrameBase64}`} className="preview-thumb" alt="End" />
                         <button className="remove-media-btn" onClick={() => removeFile('end')}>&times;</button>
                         <span style={{ position: 'absolute', bottom: 8, background: 'rgba(0,0,0,0.7)', padding: '2px 6px', borderRadius: 4, fontSize: 10, zIndex: 5 }}>End</span>
                    </div>
                )}
             </div>
        </div>

        <div className="settings-group">
            <div className="setting-item">
                <div className="setting-label">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                    Duration
                </div>
                <div className="setting-control">
                    {duration}s
                    {/* Simplified for UI - in real app could be dropdown */}
                </div>
            </div>
            <div className="setting-item">
                 <div className="setting-label">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="7" width="20" height="10" rx="2" ry="2"></rect></svg>
                    Aspect ratio
                </div>
                <div className="setting-control" onClick={() => setAspectRatio(prev => prev === '16:9' ? '9:16' : '16:9')}>
                    {aspectRatio}
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
                </div>
            </div>
            <div className="setting-item">
                <div className="setting-label">
                     <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20M2 12h20"></path><path d="m4.93 4.93 14.14 14.14"></path><path d="m19.07 4.93-14.14 14.14"></path></svg>
                    Resolution
                </div>
                 <div className="setting-control" onClick={() => setResolution(prev => prev === '720p' ? '1080p' : '720p')}>
                    {resolution}
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
                </div>
            </div>
        </div>
      </div>

      <div className="config-footer">
        {error && <div className="error-banner">{error}</div>}
        <button className="generate-btn" onClick={generateVideo} disabled={loading || !apiKeySelected}>
            {loading ? (
                <>
                  Generating...
                </>
            ) : (
                <>
                    <span style={{ marginRight: '6px' }}>✨</span> 
                    Generate • {estimatedCost} Credits
                </>
            )}
        </button>
      </div>
    </div>
  );

  const renderCanvas = () => (
    <div className="canvas-area">
      <div className="canvas-tabs">
        <button 
            className={`tab-btn ${activeTab === 'canvas' ? 'active' : ''}`}
            onClick={() => setActiveTab('canvas')}
        >
            Canvas
        </button>
        <button 
            className={`tab-btn ${activeTab === 'generations' ? 'active' : ''}`}
            onClick={() => setActiveTab('generations')}
        >
            Library
        </button>
      </div>

      <div className="canvas-content">
        {activeTab === 'canvas' ? (
            loading ? (
                <div className="loading-steps-container">
                    <h3 style={{ marginBottom: 20 }}>Creating your video...</h3>
                    {loadingSteps.map((step, index) => {
                        let status: 'completed' | 'active' | 'pending' = 'pending';
                        if (index < currentStep) status = 'completed';
                        else if (index === currentStep) status = 'active';

                        return (
                            <div key={index} className={`step-item ${status}`}>
                                <div className="step-icon">
                                    {status === 'completed' && (
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="3"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                    )}
                                    {status === 'active' && (
                                        <div className="mini-spinner"></div>
                                    )}
                                    {status === 'pending' && (
                                        <div className="empty-dot"></div>
                                    )}
                                </div>
                                <span className="step-label">{step}</span>
                            </div>
                        );
                    })}
                </div>
            ) : videoUrl ? (
                <div className="video-wrapper">
                    <video src={videoUrl} controls autoPlay loop />
                    <div className="video-actions">
                         <button className="action-btn" onClick={handleDownload}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                            Download
                         </button>
                    </div>
                </div>
            ) : (
                <div className="empty-state">
                    <svg className="empty-icon" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="1"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
                    <h3>No video generations yet</h3>
                    <p>Generate your first video to see it here.</p>
                </div>
            )
        ) : (
            // Generations Tab (Library)
            <div className="generations-grid">
                {history.length === 0 ? (
                    <div className="empty-state" style={{ gridColumn: '1/-1', marginTop: 40 }}>
                        <p>No history yet.</p>
                    </div>
                ) : (
                    history.map((item, idx) => (
                        <div key={idx} className="history-card" onClick={() => { setVideoUrl(item.videoUrl); setActiveTab('canvas'); }}>
                            <div className="history-thumbnail">
                                <video src={item.videoUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted onMouseOver={e => e.currentTarget.play()} onMouseOut={e => e.currentTarget.pause()} />
                            </div>
                            <div className="history-info">
                                <div className="history-prompt">{item.prompt}</div>
                                <div className="history-date">{item.config}</div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        )}
      </div>
    </div>
  );

  return (
    <div className={`app-container tab-${activeTab}`}>
      {renderIconSidebar()}
      {renderConfigPanel()}
      {renderCanvas()}

      {!apiKeySelected && (
         <div className="modal-overlay">
            <div className="modal-content">
                <h2>Connect Vertex AI</h2>
                <p style={{ color: '#a1a1aa', marginTop: 12, lineHeight: 1.5 }}>
                    To use Veo 3.1, you need to connect your Google Cloud API Key with Vertex AI enabled.
                </p>
                <button className="btn-primary" onClick={handleSelectKey}>Connect API Key</button>
            </div>
         </div>
      )}

      {isPricingOpen && (
          <div className="modal-overlay" onClick={(e) => { if(e.target === e.currentTarget) setIsPricingOpen(false) }}>
              <div className="modal-content pricing-modal">
                  <div className="modal-drag-handle"></div>
                  <button className="modal-close" onClick={() => setIsPricingOpen(false)}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                  </button>
                  
                  <div className="pricing-header">
                      <h2>Pricing & Security</h2>
                      <p>Secure-first video generation for teams and enterprises.</p>
                  </div>

                  {/* Main Pricing Tabs */}
                  <div className="pricing-main-tabs">
                    <button 
                        className={`main-tab-btn ${pricingTab === 'subscribe' ? 'active' : ''}`}
                        onClick={() => setPricingTab('subscribe')}
                    >
                        Subscribe
                    </button>
                    <button 
                        className={`main-tab-btn ${pricingTab === 'topup' ? 'active' : ''}`}
                        onClick={() => setPricingTab('topup')}
                    >
                        Pay As You Go
                    </button>
                  </div>

                  {/* Subscription Content */}
                  {pricingTab === 'subscribe' && (
                    <>
                        <div className="billing-toggle">
                            <button 
                                className={`toggle-option ${billingCycle === 'monthly' ? 'active' : ''}`}
                                onClick={() => setBillingCycle('monthly')}
                            >
                                Monthly
                            </button>
                            <button 
                                className={`toggle-option ${billingCycle === 'yearly' ? 'active' : ''}`}
                                onClick={() => setBillingCycle('yearly')}
                            >
                                Yearly <span className="discount-badge">-25%</span>
                            </button>
                        </div>

                        <div className="pricing-slider">
                            <button className="slider-arrow left" onClick={prevPlan}>
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"></polyline></svg>
                            </button>

                            <div className="slider-content">
                                <div className="pricing-option active">
                                    <div className="option-header">
                                        <div>
                                            <span className="plan-name">{currentPlan.name}</span>
                                            <div className="plan-subheading">{currentPlan.subheading}</div>
                                        </div>
                                        <span className="plan-price">
                                            ${billingCycle === 'monthly' ? currentPlan.price.monthly : currentPlan.price.yearly}
                                            <span className="period">/{billingCycle === 'monthly' ? 'mo' : 'yr'}</span>
                                        </span>
                                    </div>
                                    
                                    <p className="plan-desc">{currentPlan.description}</p>

                                    <div className="option-features">
                                        {currentPlan.features.map((feature, i) => (
                                            <div className="feature-item" key={i}>
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="3"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                                {feature}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <button className="slider-arrow right" onClick={nextPlan}>
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
                            </button>
                        </div>
                        <button className="btn-primary subscribe-btn">Subscribe to {currentPlan.name.split(' ')[0]}</button>
                    </>
                  )}

                  {/* Pay As You Go Content */}
                  {pricingTab === 'topup' && (
                    <>
                        <div style={{ height: 20 }}></div> {/* Spacer replacing toggle */}
                        <div className="pricing-slider">
                            <button className="slider-arrow left" onClick={prevPack}>
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"></polyline></svg>
                            </button>

                            <div className="slider-content">
                                <div className="pricing-option active credit-pack-card">
                                    <div className="pack-header">
                                        <span className="pack-label">{currentPack.label}</span>
                                        <span className="pack-price">${currentPack.price}</span>
                                    </div>

                                    <div className="credit-amount-display">
                                        <span className="amount-text">{currentPack.credits.toLocaleString()} Credits</span>
                                    </div>

                                    <div className="pack-details">
                                        <p>One-time purchase. AES-256 secure checkout.</p>
                                        <div className="video-estimate">
                                            ≈ {Math.floor(currentPack.credits / 100)} standard videos
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <button className="slider-arrow right" onClick={nextPack}>
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
                            </button>
                        </div>
                        <button className="btn-primary subscribe-btn">Buy {currentPack.credits.toLocaleString()} Credits</button>
                    </>
                  )}

                  <button className="btn-text close-mobile-btn" onClick={() => setIsPricingOpen(false)}>Maybe Later</button>
              </div>
          </div>
      )}

      {isProfileOpen && (
          <div className="modal-overlay">
              <div className="modal-content" style={{ maxWidth: 400 }}>
                  <button className="modal-close" onClick={() => setIsProfileOpen(false)}>&times;</button>
                  <h2 style={{ marginBottom: 8 }}>
                    {authMode === 'signin' ? 'Welcome back' : 'Create an account'}
                  </h2>
                  <p style={{ color: '#a1a1aa', fontSize: 14, marginBottom: 24 }}>
                    {authMode === 'signin' ? 'Enter your details to access your secure workspace.' : 'Start your creative journey today.'}
                  </p>
                  
                  <div className="auth-form">
                    <div className="form-group">
                        <label className="form-label">Email</label>
                        <input type="email" className="form-input" placeholder="name@example.com" />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Password</label>
                        <input type="password" className="form-input" placeholder="••••••••" />
                    </div>
                    <button className="btn-primary" style={{ width: '100%', marginTop: 8 }} onClick={() => setIsProfileOpen(false)}>
                        {authMode === 'signin' ? 'Sign In' : 'Sign Up'}
                    </button>
                    
                    <div style={{ display: 'flex', alignItems: 'center', margin: '12px 0', gap: '12px' }}>
                        <div style={{ flex: 1, height: '1px', background: 'var(--border-color)' }}></div>
                        <span style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>or</span>
                        <div style={{ flex: 1, height: '1px', background: 'var(--border-color)' }}></div>
                    </div>

                    <button 
                        className="btn-secondary" 
                        style={{ 
                            width: '100%', 
                            display: 'flex', 
                            alignItems: 'center', 
                            justifyContent: 'center', 
                            gap: '10px',
                            background: '#1a1a1a',
                            border: '1px solid var(--border-color)',
                            color: '#fff',
                            padding: '12px',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            fontSize: '14px',
                            fontWeight: '500'
                        }}
                        onClick={() => setIsProfileOpen(false)}
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24">
                            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                        </svg>
                        Continue with Google
                    </button>
                  </div>

                  <div className="auth-footer">
                    {authMode === 'signin' ? (
                        <>Don't have an account? <span onClick={() => setAuthMode('signup')}>Sign up</span></>
                    ) : (
                        <>Already have an account? <span onClick={() => setAuthMode('signin')}>Sign in</span></>
                    )}
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(<VideoGeneratorApp />);

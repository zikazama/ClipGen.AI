
import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, Modality } from '@google/genai';

const loadingSteps = [
  "Initializing Veo 3.1 model",
  "Analyzing inputs & vectors",
  "Synthesizing motion",
  "Rendering video frames",
  "Applying cinematic lighting",
  "Finalizing output",
];

const editingSteps = [
  "Analyzing frame color space",
  "Applying creative luts",
  "Interpolating motion vectors",
  "Finalizing edit",
];

interface HistoryItem {
  prompt: string;
  videoUrl: string;
  timestamp: number;
  config: string;
}

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
  const [userPlanIndex, setUserPlanIndex] = useState(0); // 0: Starter, 1: Pro, 2: Enterprise

  // Editing State
  const [showEditor, setShowEditor] = useState(false);
  const [isApplyingEdits, setIsApplyingEdits] = useState(false);
  const [editParams, setEditParams] = useState({
    brightness: 100,
    contrast: 100,
    speed: 1,
    filter: 'none'
  });

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
  const isEligibleForEditing = userPlanIndex >= 1;

  // --- Effects ---

  useEffect(() => {
    const checkApiKey = async () => {
      if (window.aistudio && await window.aistudio.hasSelectedApiKey()) {
        setApiKeySelected(true);
      }
    };
    checkApiKey();
  }, []);

  // Auto-scroll to result on mobile when videoUrl changes
  useEffect(() => {
    if (videoUrl && window.innerWidth <= 768) {
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
          const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({sampleRate: 24000});
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
    setShowEditor(false);
    
    let stepIdx = 0;
    const stepInterval = setInterval(() => {
        stepIdx++;
        if (stepIdx < loadingSteps.length) {
            setCurrentStep(stepIdx);
        }
    }, 4500);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const config: any = {
        numberOfVideos: 1,
        resolution: resolution,
        aspectRatio: aspectRatio,
      };

      if (endFrameBase64 && endFrame) {
        config.lastFrame = {
            imageBytes: endFrameBase64,
            mimeType: endFrame.type,
        };
      }

      const payload: any = {
        model: 'veo-3.1-fast-generate-preview',
        prompt: prompt || "A high quality video",
        config: config
      };

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
      if (e.message) errorMessage = e.message;
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

  const applyEdits = async () => {
    setIsApplyingEdits(true);
    setCurrentStep(0);
    
    // Simulate processing
    for (let i = 0; i < editingSteps.length; i++) {
        setCurrentStep(i);
        await new Promise(r => setTimeout(r, 1500));
    }
    
    setIsApplyingEdits(false);
    setShowEditor(false);
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
            <div className="model-selector">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><polygon points="10 8 16 12 10 16 10 8"></polygon></svg>
                Veo 3.1 Fast
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </div>
        </div>
        <p className="panel-description">
            A balanced model for quick turnarounds and creative exploration.
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
                <div className="setting-control">{duration}s</div>
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
            {loading ? "Generating..." : <> <span style={{ marginRight: '6px' }}>✨</span> Generate • {estimatedCost} Credits </>}
        </button>
      </div>
    </div>
  );

  const renderEditorPanel = () => (
    <div className={`editing-sidebar ${showEditor ? 'visible' : ''}`}>
        <div className="sidebar-inner">
            <div className="sidebar-header">
                <h3>Advanced Edits</h3>
                <button className="icon-btn" onClick={() => setShowEditor(false)}>&times;</button>
            </div>

            {!isEligibleForEditing && (
                <div className="locked-overlay">
                    <div className="locked-content">
                        <div className="lock-icon">
                            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                        </div>
                        <h4>Pro Feature</h4>
                        <p>Unlock editing tools with a Pro subscription.</p>
                        <button className="btn-primary" onClick={() => setIsPricingOpen(true)}>Upgrade Now</button>
                    </div>
                </div>
            )}

            <div className="sidebar-scroll">
                <div className="edit-group">
                    <label className="section-label">Color Grading</label>
                    <div className="slider-item">
                        <span>Brightness</span>
                        <input type="range" min="50" max="150" value={editParams.brightness} onChange={(e) => setEditParams({...editParams, brightness: parseInt(e.target.value)})} />
                    </div>
                    <div className="slider-item">
                        <span>Contrast</span>
                        <input type="range" min="50" max="150" value={editParams.contrast} onChange={(e) => setEditParams({...editParams, contrast: parseInt(e.target.value)})} />
                    </div>
                </div>

                <div className="edit-group">
                    <label className="section-label">Motion Control</label>
                    <div className="speed-chips">
                        {[0.5, 1, 1.5, 2].map(s => (
                            <button key={s} className={`chip ${editParams.speed === s ? 'active' : ''}`} onClick={() => setEditParams({...editParams, speed: s})}>{s}x</button>
                        ))}
                    </div>
                </div>

                <div className="edit-group">
                    <label className="section-label">Cinematic Filters</label>
                    <div className="filter-grid">
                        {['none', 'noir', 'vintage', 'cyber', 'vibrant'].map(f => (
                            <button key={f} className={`filter-chip ${editParams.filter === f ? 'active' : ''}`} onClick={() => setEditParams({...editParams, filter: f})}>
                                <div className={`filter-preview ${f}`} />
                                <span>{f.charAt(0).toUpperCase() + f.slice(1)}</span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            <div className="sidebar-footer">
                <button className="btn-primary apply-btn" onClick={applyEdits} disabled={isApplyingEdits}>
                    {isApplyingEdits ? "Applying..." : "Apply Changes"}
                </button>
            </div>
        </div>
    </div>
  );

  const renderCanvas = () => (
    <div className="canvas-area">
      <div className="canvas-tabs">
        <button className={`tab-btn ${activeTab === 'canvas' ? 'active' : ''}`} onClick={() => setActiveTab('canvas')}>Canvas</button>
        <button className={`tab-btn ${activeTab === 'generations' ? 'active' : ''}`} onClick={() => setActiveTab('generations')}>Library</button>
      </div>

      <div className="canvas-main-layout">
        <div className="canvas-content">
            {activeTab === 'canvas' ? (
                loading || isApplyingEdits ? (
                    <div className="loading-steps-container">
                        <h3 style={{ marginBottom: 20 }}>{isApplyingEdits ? "Applying edits..." : "Creating your video..."}</h3>
                        {(isApplyingEdits ? editingSteps : loadingSteps).map((step, index) => {
                            let status: 'completed' | 'active' | 'pending' = 'pending';
                            if (index < currentStep) status = 'completed';
                            else if (index === currentStep) status = 'active';

                            return (
                                <div key={index} className={`step-item ${status}`}>
                                    <div className="step-icon">
                                        {status === 'completed' && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="3"><polyline points="20 6 9 17 4 12"></polyline></svg>}
                                        {status === 'active' && <div className="mini-spinner"></div>}
                                        {status === 'pending' && <div className="empty-dot"></div>}
                                    </div>
                                    <span className="step-label">{step}</span>
                                </div>
                            );
                        })}
                    </div>
                ) : videoUrl ? (
                    <div className="video-wrapper">
                        <video src={videoUrl} controls autoPlay loop style={{ 
                            filter: `brightness(${editParams.brightness}%) contrast(${editParams.contrast}%)` 
                        }} />
                        <div className="video-actions">
                            <button className="action-btn" onClick={() => setShowEditor(true)}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                                Edit Video
                            </button>
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
                <div className="generations-grid">
                    {history.length === 0 ? <p className="empty-state">No history yet.</p> : history.map((item, idx) => (
                        <div key={idx} className="history-card" onClick={() => { setVideoUrl(item.videoUrl); setActiveTab('canvas'); }}>
                            <div className="history-thumbnail"><video src={item.videoUrl} muted /></div>
                            <div className="history-info">
                                <div className="history-prompt">{item.prompt}</div>
                                <div className="history-date">{item.config}</div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
        {activeTab === 'canvas' && renderEditorPanel()}
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
                <p style={{ color: '#a1a1aa', marginTop: 12, lineHeight: 1.5 }}>To use Veo 3.1, you need to connect your Google Cloud API Key with Vertex AI enabled.</p>
                <button className="btn-primary" onClick={handleSelectKey}>Connect API Key</button>
            </div>
         </div>
      )}

      {isPricingOpen && (
          <div className="modal-overlay" onClick={(e) => { if(e.target === e.currentTarget) setIsPricingOpen(false) }}>
              <div className="modal-content pricing-modal">
                  <div className="modal-drag-handle"></div>
                  <button className="modal-close" onClick={() => setIsPricingOpen(false)}>&times;</button>
                  <div className="pricing-header">
                      <h2>Pricing & Security</h2>
                      <p>Secure-first video generation for teams and enterprises.</p>
                  </div>
                  <div className="pricing-main-tabs">
                    <button className={`main-tab-btn ${pricingTab === 'subscribe' ? 'active' : ''}`} onClick={() => setPricingTab('subscribe')}>Subscribe</button>
                    <button className={`main-tab-btn ${pricingTab === 'topup' ? 'active' : ''}`} onClick={() => setPricingTab('topup')}>Pay As You Go</button>
                  </div>
                  {pricingTab === 'subscribe' && (
                    <>
                        <div className="billing-toggle">
                            <button className={`toggle-option ${billingCycle === 'monthly' ? 'active' : ''}`} onClick={() => setBillingCycle('monthly')}>Monthly</button>
                            <button className={`toggle-option ${billingCycle === 'yearly' ? 'active' : ''}`} onClick={() => setBillingCycle('yearly')}>Yearly <span className="discount-badge">-25%</span></button>
                        </div>
                        <div className="pricing-slider">
                            <button className="slider-arrow left" onClick={prevPlan}>&lt;</button>
                            <div className="slider-content">
                                <div className="pricing-option active">
                                    <div className="option-header">
                                        <div><span className="plan-name">{currentPlan.name}</span><div className="plan-subheading">{currentPlan.subheading}</div></div>
                                        <span className="plan-price">${billingCycle === 'monthly' ? currentPlan.price.monthly : currentPlan.price.yearly}<span className="period">/{billingCycle === 'monthly' ? 'mo' : 'yr'}</span></span>
                                    </div>
                                    <p className="plan-desc">{currentPlan.description}</p>
                                    <div className="option-features">{currentPlan.features.map((feature, i) => (<div className="feature-item" key={i}>✓ {feature}</div>))}</div>
                                </div>
                            </div>
                            <button className="slider-arrow right" onClick={nextPlan}>&gt;</button>
                        </div>
                        <button className="btn-primary subscribe-btn" onClick={() => { setUserPlanIndex(activePlanIndex); setIsPricingOpen(false); }}>
                            {userPlanIndex === activePlanIndex ? "Current Plan" : `Subscribe to ${currentPlan.name.split(' ')[0]}`}
                        </button>
                    </>
                  )}
              </div>
          </div>
      )}

      {isProfileOpen && (
          <div className="modal-overlay">
              <div className="modal-content" style={{ maxWidth: 400 }}>
                  <button className="modal-close" onClick={() => setIsProfileOpen(false)}>&times;</button>
                  <h2>{authMode === 'signin' ? 'Welcome back' : 'Create an account'}</h2>
                  <div className="auth-form">
                    <div className="form-group"><label className="form-label">Email</label><input type="email" className="form-input" placeholder="name@example.com" /></div>
                    <div className="form-group"><label className="form-label">Password</label><input type="password" className="form-input" placeholder="••••••••" /></div>
                    <button className="btn-primary" style={{ width: '100%' }} onClick={() => setIsProfileOpen(false)}>{authMode === 'signin' ? 'Sign In' : 'Sign Up'}</button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(<VideoGeneratorApp />);

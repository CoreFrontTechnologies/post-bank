import React, { useState, useEffect, useMemo } from "react";
import { 
  Plus, 
  Search, 
  Share2, 
  Trash2, 
  Image as ImageIcon, 
  Sparkles, 
  Loader2, 
  Copy, 
  MessageSquare, 
  Facebook, 
  Instagram, 
  Send,
  LayoutGrid,
  List as ListIcon,
  ChevronRight,
  Download,
  CheckCircle2,
  Zap,
  Filter,
  BarChart3,
  FileJson,
  FileSpreadsheet,
  Settings2,
  RefreshCw,
  X,
  Wand2,
  TrendingUp,
  Target,
  BrainCircuit
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import ReactMarkdown from "react-markdown";
import { GoogleGenAI } from "@google/genai";
import { cn } from "./lib/utils";
import Dexie, { type Table } from "dexie";
import { useLiveQuery } from "dexie-react-hooks";

// --- Database Setup (IndexedDB for Netlify Compatibility) ---

export interface Post {
  id?: number;
  title: string;
  content: string;
  thumbnail_url: string;
  thumbnail_prompt?: string;
  style: string;
  virality_score: number;
  created_at: number;
}

export interface Reminder {
  id?: number;
  postId: number;
  postTitle: string;
  time: number;
  notified: boolean;
}

class PostBankDB extends Dexie {
  posts!: Table<Post>;
  reminders!: Table<Reminder>;

  constructor() {
    super("PostBankDB");
    this.version(2).stores({
      posts: "++id, title, style, created_at",
      reminders: "++id, postId, time, notified"
    });
  }
}

const db = new PostBankDB();

// --- Constants & Samples ---

const STYLES = [
  { id: "ceo", name: "Digital CEO", icon: <TrendingUp size={16} />, description: "Bold, authoritative, and future-focused." },
  { id: "mentor", name: "Supportive Mentor", icon: <BrainCircuit size={16} />, description: "Empathetic, guiding, and value-driven." },
  { id: "expert", name: "Technical Expert", icon: <Target size={16} />, description: "Data-driven, precise, and tool-focused." },
  { id: "storyteller", name: "Storyteller", icon: <Sparkles size={16} />, description: "Narrative, emotional, and relatable." },
];

// --- Notification Helper ---
const requestNotificationPermission = async () => {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  const permission = await Notification.requestPermission();
  return permission === "granted";
};

const sendNotification = (title: string, body: string) => {
  if (Notification.permission === "granted") {
    new Notification(title, { body, icon: "/favicon.ico" });
  } else {
    alert(`REMINDER: ${title}\n${body}`);
  }
};

const SAMPLES = [
  "The 2026 'Digital CEO' Manifesto: 2025 is almost in the rearview mirror. Some of you spent this year 'getting ready.' You 'planned' to start. You 'intended' to learn AI. You 'hoped' to find clients. Hope is not a business strategy...",
  "The Death of the 'Commodity' Freelancer: In 2025, you could still survive by being 'the guy who does everything.' Web design? You do it. Graphics? You do it. Data entry? You do it. But in 2026, the 'Generalist' is going to starve...",
  "Stop Charging for Your Time—Charge for the 'Gap': In 2025, you probably billed by the hour. You told the client, 'I’ll work for 5 hours at $20/hour,' and you made $100. In 2026, that pricing model will keep you broke...",
];

// --- Gemini Service ---

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

async function generatePostsBulk(topic: string, style: string, count: number) {
  const styleObj = STYLES.find(s => s.id === style) || STYLES[0];
  
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Generate ${count} unique, viral social media posts for freelancers based on the following theme: "${topic}".
    
    Style: ${styleObj.name} (${styleObj.description})
    
    Reference Samples for Tone and Structure:
    ${SAMPLES.join("\n\n")}
    
    Each post must follow this JSON structure:
    {
      "posts": [
        {
          "title": "Short catchy title",
          "content": "Full post content with emojis and bullet points",
          "virality_score": 0-100 (integer)
        }
      ]
    }
    
    Ensure the content is high-value, bold, and uses the "Digital CEO" terminology where appropriate. 
    Output ONLY the JSON.`,
    config: {
      responseMimeType: "application/json"
    }
  });

  try {
    const data = JSON.parse(response.text || "{}");
    return data.posts as Array<{ title: string; content: string; virality_score: number }>;
  } catch (e) {
    console.error("JSON Parse Error", e);
    return [];
  }
}

async function generateThumbnail(postContent: string, customPrompt?: string) {
  let prompt = customPrompt;
  
  if (!prompt) {
    const promptResponse = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Create a professional image generation prompt for a social media thumbnail based on this post: "${postContent}". Output ONLY the prompt.`,
    });
    prompt = promptResponse.text || "Professional workspace with AI elements";
  }

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: { parts: [{ text: prompt }] },
    config: { imageConfig: { aspectRatio: "16:9" } },
  });

  for (const part of response.candidates[0].content.parts) {
    if (part.inlineData) {
      return {
        url: `data:image/png;base64,${part.inlineData.data}`,
        prompt: prompt
      };
    }
  }
  return {
    url: `https://picsum.photos/seed/${Math.random()}/800/450`,
    prompt: prompt
  };
}

// --- Components ---

export default function App() {
  const posts = useLiveQuery(() => db.posts.orderBy("created_at").reverse().toArray()) || [];
  const [isGenerating, setIsGenerating] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStyle, setFilterStyle] = useState<string>("all");
  const [minVirality, setMinVirality] = useState<number>(0);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [showGenModal, setShowGenModal] = useState(false);
  const [genConfig, setGenConfig] = useState({ topic: "", style: "ceo", count: 5 });
  const [copySuccess, setCopySuccess] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [customThumbPrompt, setCustomThumbPrompt] = useState("");
  const [isRegeneratingThumb, setIsRegeneratingThumb] = useState(false);
  const [reminderTime, setReminderTime] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState("");
  const [editedContent, setEditedContent] = useState("");
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  // Online/Offline Status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Reminder Checker
  useEffect(() => {
    const interval = setInterval(async () => {
      const now = Date.now();
      const dueReminders = await db.reminders
        .where("time")
        .belowOrEqual(now)
        .and(r => !r.notified)
        .toArray();

      for (const r of dueReminders) {
        sendNotification("Post Reminder", `Time to share: ${r.postTitle}`);
        await db.reminders.update(r.id!, { notified: true });
      }
    }, 10000); // Check every 10 seconds

    return () => clearInterval(interval);
  }, []);

  // Seed initial data if empty
  useEffect(() => {
    const seed = async () => {
      const count = await db.posts.count();
      if (count === 0) {
        await db.posts.bulkAdd([
          {
            title: "The 2026 'Digital CEO' Manifesto",
            content: "2025 is almost in the rearview mirror. Some of you spent this year 'getting ready.' You 'planned' to start. You 'intended' to learn AI. You 'hoped' to find clients. Hope is not a business strategy...",
            thumbnail_url: "https://picsum.photos/seed/ceo/800/450",
            style: "ceo",
            virality_score: 95,
            created_at: Date.now() - 10000
          },
          {
            title: "The Death of the 'Commodity' Freelancer",
            content: "In 2025, you could still survive by being 'the guy who does everything.' Web design? You do it. Graphics? You do it. Data entry? You do it. But in 2026, the 'Generalist' is going to starve...",
            thumbnail_url: "https://picsum.photos/seed/specialist/800/450",
            style: "ceo",
            virality_score: 92,
            created_at: Date.now() - 20000
          }
        ]);
      }
    };
    seed();
  }, []);

  const handleBulkGenerate = async () => {
    if (!genConfig.topic) return;
    setIsGenerating(true);
    setProgress(0);
    
    const totalToGen = genConfig.count;
    const chunkSize = 5;
    const iterations = Math.ceil(totalToGen / chunkSize);
    
    try {
      for (let i = 0; i < iterations; i++) {
        const currentBatchSize = Math.min(chunkSize, totalToGen - i * chunkSize);
        const generated = await generatePostsBulk(genConfig.topic, genConfig.style, currentBatchSize);
        
        const newPosts: Post[] = [];
        for (let j = 0; j < generated.length; j++) {
          const p = generated[j];
          // Generate real thumbnail for each post in the batch
          let thumbnailUrl = `https://picsum.photos/seed/${Math.random()}/800/450`;
          let thumbnailPrompt = "";
          try {
            const thumbResult = await generateThumbnail(p.content);
            thumbnailUrl = thumbResult.url;
            thumbnailPrompt = thumbResult.prompt;
          } catch (e) {
            console.warn("Thumbnail generation failed for post, using fallback", e);
          }

          newPosts.push({
            title: p.title,
            content: p.content,
            thumbnail_url: thumbnailUrl,
            thumbnail_prompt: thumbnailPrompt,
            style: genConfig.style,
            virality_score: p.virality_score,
            created_at: Date.now() - (i * chunkSize + j)
          });
        }
        
        await db.posts.bulkAdd(newPosts);
        setProgress(Math.round(((i + 1) / iterations) * 100));
      }
      
      setShowGenModal(false);
      setGenConfig({ ...genConfig, topic: "" });
    } catch (err) {
      console.error("Generation failed", err);
      alert("Generation encountered an error. Some posts may have been saved.");
    } finally {
      setIsGenerating(false);
      setProgress(0);
    }
  };

  const handleDelete = async (id?: number) => {
    if (!id || !confirm("Delete this insight?")) return;
    await db.posts.delete(id);
    if (selectedPost?.id === id) setSelectedPost(null);
  };

  const handleExportCSV = () => {
    const headers = ["Title", "Content", "Style", "Virality Score", "Created At"];
    const rows = posts.map(p => [
      `"${p.title.replace(/"/g, '""')}"`,
      `"${p.content.replace(/"/g, '""')}"`,
      p.style,
      p.virality_score,
      new Date(p.created_at).toISOString()
    ]);
    const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `post-bank-export-${Date.now()}.csv`;
    a.click();
  };

  const handleRegenerateThumbnail = async (post: Post) => {
    if (!post.id) return;
    setIsRegeneratingThumb(true);
    try {
      const thumbResult = await generateThumbnail(post.content, customThumbPrompt);
      await db.posts.update(post.id, { 
        thumbnail_url: thumbResult.url,
        thumbnail_prompt: thumbResult.prompt 
      });
      if (selectedPost?.id === post.id) {
        setSelectedPost({ 
          ...selectedPost, 
          thumbnail_url: thumbResult.url,
          thumbnail_prompt: thumbResult.prompt 
        });
      }
      setCustomThumbPrompt("");
    } catch (err) {
      console.error("Failed to regenerate thumbnail", err);
    } finally {
      setIsRegeneratingThumb(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!selectedPost?.id) return;
    try {
      await db.posts.update(selectedPost.id, {
        title: editedTitle,
        content: editedContent
      });
      setSelectedPost({
        ...selectedPost,
        title: editedTitle,
        content: editedContent
      });
      setIsEditing(false);
    } catch (err) {
      console.error("Failed to save edit", err);
    }
  };

  const handleOptimize = async () => {
    if (!selectedPost) return;
    setIsOptimizing(true);
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Optimize this social media post for maximum virality. Keep the same core message but improve the hook, structure, and call to action. 
        Title: ${selectedPost.title}
        Content: ${selectedPost.content}
        
        Output ONLY the optimized JSON:
        { "title": "...", "content": "...", "virality_score": ... }`,
        config: { responseMimeType: "application/json" }
      });
      const data = JSON.parse(response.text || "{}");
      setEditedTitle(data.title);
      setEditedContent(data.content);
      setIsEditing(true);
    } catch (err) {
      console.error("Optimization failed", err);
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleTranslate = async (lang: string) => {
    if (!selectedPost) return;
    setIsTranslating(true);
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Translate this social media post to ${lang}. Maintain the viral tone and style.
        Title: ${selectedPost.title}
        Content: ${selectedPost.content}
        
        Output ONLY the translated JSON:
        { "title": "...", "content": "..." }`,
        config: { responseMimeType: "application/json" }
      });
      const data = JSON.parse(response.text || "{}");
      setEditedTitle(data.title);
      setEditedContent(data.content);
      setIsEditing(true);
    } catch (err) {
      console.error("Translation failed", err);
    } finally {
      setIsTranslating(false);
    }
  };

  const handleSetReminder = async (post: Post) => {
    if (!reminderTime) return;
    const time = new Date(reminderTime).getTime();
    if (isNaN(time)) return;

    await requestNotificationPermission();
    await db.reminders.add({
      postId: post.id!,
      postTitle: post.title,
      time,
      notified: false
    });
    setReminderTime("");
    alert("Reminder set successfully!");
  };

  const handleShare = async (post: Post, platform: string) => {
    const text = `${post.title}\n\n${post.content}`;
    const encodedText = encodeURIComponent(text);
    const url = window.location.href;

    // Native Web Share API (Best for mobile)
    if (platform === "native" && navigator.share) {
      try {
        await navigator.share({
          title: post.title,
          text: text,
          url: url,
        });
        return;
      } catch (err) {
        console.error("Native share failed", err);
      }
    }

    const shareUrls: Record<string, string> = {
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${url}&quote=${encodedText}`,
      whatsapp: `https://api.whatsapp.com/send?text=${encodedText}`,
      twitter: `https://twitter.com/intent/tweet?text=${encodedText}`,
      instagram: `https://www.instagram.com/`, // Instagram doesn't support direct text sharing via URL
    };

    if (platform === "instagram") {
      // For Instagram, we copy text first then open the app
      navigator.clipboard.writeText(text);
      setCopySuccess(post.id!);
      setTimeout(() => setCopySuccess(null), 2000);
      alert("Content copied! Opening Instagram... You can now paste your caption and upload the thumbnail.");
      window.open(shareUrls.instagram, "_blank");
      return;
    }

    if (shareUrls[platform]) {
      window.open(shareUrls[platform], "_blank");
    }
  };

  const handleDownloadImage = async (post: Post) => {
    try {
      const response = await fetch(post.thumbnail_url);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${post.title.slice(0, 20)}.png`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error("Download failed", err);
    }
  };

  const filteredPosts = useMemo(() => {
    return posts.filter(p => {
      const matchesSearch = p.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                           p.content.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStyle = filterStyle === "all" || p.style === filterStyle;
      const matchesVirality = p.virality_score >= minVirality;
      return matchesSearch && matchesStyle && matchesVirality;
    });
  }, [posts, searchQuery, filterStyle, minVirality]);

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white font-sans selection:bg-emerald-500 selection:text-black">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-black/80 backdrop-blur-xl border-b border-white/5 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-emerald-500 rounded-2xl flex items-center justify-center text-black shadow-lg shadow-emerald-500/20 rotate-3">
              <Zap size={24} fill="currentColor" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tighter uppercase">Post Bank <span className="text-emerald-500">v2</span></h1>
              <div className="flex items-center gap-2">
                <p className="text-[10px] font-bold text-white/40 uppercase tracking-[0.3em]">Digital CEO Engine</p>
                <div className={cn("w-1.5 h-1.5 rounded-full", isOnline ? "bg-emerald-500" : "bg-red-500")} />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative hidden md:block">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20" size={18} />
              <input 
                type="text" 
                placeholder="Search the vault..." 
                className="pl-12 pr-6 py-3 bg-white/5 border border-white/10 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 w-80 transition-all"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            
            <button 
              onClick={handleExportCSV}
              className="p-3 bg-white/5 hover:bg-white/10 rounded-2xl border border-white/10 transition-colors"
              title="Export CSV"
            >
              <FileSpreadsheet size={20} className="text-white/60" />
            </button>

            <button 
              onClick={() => setShowGenModal(true)}
              className="bg-emerald-500 text-black px-6 py-3 rounded-2xl text-sm font-black flex items-center gap-2 hover:bg-emerald-400 transition-all active:scale-95 shadow-xl shadow-emerald-500/20"
            >
              <Wand2 size={18} />
              <span>Bulk Generate</span>
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-12">
        {/* Upcoming Reminders Dashboard */}
        <AnimatePresence>
          {posts.length > 0 && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-12 p-8 bg-emerald-500/5 border border-emerald-500/20 rounded-[3rem] overflow-hidden relative"
            >
              <div className="flex items-center gap-4 mb-6">
                <div className="p-3 bg-emerald-500 rounded-2xl text-black">
                  <BarChart3 size={20} />
                </div>
                <div>
                  <h2 className="text-xl font-black tracking-tight uppercase">Content Pipeline</h2>
                  <p className="text-xs font-bold text-emerald-500/60 uppercase tracking-widest">Scheduled Insights</p>
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {posts.slice(0, 3).map((p, i) => (
                  <div key={i} className="p-4 bg-white/5 border border-white/10 rounded-2xl flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0">
                      <img src={p.thumbnail_url} className="w-full h-full object-cover" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-black truncate">{p.title}</p>
                      <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest">Ready to deploy</p>
                    </div>
                    <ChevronRight size={16} className="text-white/20" />
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Stats / Filter Bar */}
        <div className="flex flex-col gap-8 mb-12">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-8">
              <div className="flex flex-col">
                <span className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-1">Total Insights</span>
                <span className="text-3xl font-black">{posts.length}</span>
              </div>
              <div className="w-px h-10 bg-white/10" />
              <div className="flex flex-col">
                <span className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-1">Avg Virality</span>
                <span className="text-3xl font-black text-emerald-500">
                  {posts.length ? Math.round(posts.reduce((acc, p) => acc + p.virality_score, 0) / posts.length) : 0}%
                </span>
              </div>
            </div>

            <div className="flex bg-white/5 border border-white/10 rounded-2xl p-1.5">
              <button 
                onClick={() => setViewMode("grid")}
                className={cn("px-4 py-2 rounded-xl text-xs font-bold transition-all", viewMode === "grid" ? "bg-white text-black" : "text-white/40 hover:text-white")}
              >
                Grid
              </button>
              <button 
                onClick={() => setViewMode("list")}
                className={cn("px-4 py-2 rounded-xl text-xs font-bold transition-all", viewMode === "list" ? "bg-white text-black" : "text-white/40 hover:text-white")}
              >
                List
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 p-6 bg-white/5 border border-white/10 rounded-[2rem]">
            <div className="flex items-center gap-3">
              <Filter size={16} className="text-emerald-500" />
              <span className="text-xs font-bold uppercase tracking-widest text-white/40">Quick Filters:</span>
            </div>
            
            <select 
              value={filterStyle}
              onChange={(e) => setFilterStyle(e.target.value)}
              className="bg-black border border-white/10 rounded-xl px-4 py-2 text-xs font-bold outline-none focus:ring-1 focus:ring-emerald-500"
            >
              <option value="all">All Styles</option>
              {STYLES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>

            <div className="flex items-center gap-3 bg-black border border-white/10 rounded-xl px-4 py-2">
              <span className="text-[10px] font-bold text-white/40 uppercase">Min Virality:</span>
              <input 
                type="range" min="0" max="100" step="5"
                className="w-24 accent-emerald-500 h-1 bg-white/10 rounded-full appearance-none"
                value={minVirality}
                onChange={(e) => setMinVirality(parseInt(e.target.value))}
              />
              <span className="text-xs font-black min-w-[2rem]">{minVirality}%</span>
            </div>

            <button 
              onClick={() => { setFilterStyle("all"); setMinVirality(0); setSearchQuery(""); }}
              className="text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-emerald-500 transition-colors ml-auto"
            >
              Reset All
            </button>
          </div>
        </div>

        {/* Grid */}
        <div className={cn(
          "grid gap-8",
          viewMode === "grid" ? "grid-cols-1 md:grid-cols-2 lg:grid-cols-3" : "grid-cols-1"
        )}>
          <AnimatePresence mode="popLayout">
            {filteredPosts.map((post) => (
              <motion.div
                key={post.id}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className={cn(
                  "group relative bg-[#111] border border-white/5 rounded-[2.5rem] overflow-hidden hover:border-emerald-500/30 transition-all duration-500",
                  viewMode === "list" && "flex flex-col md:flex-row h-auto md:h-72"
                )}
              >
                {/* Virality Badge */}
                <div className="absolute top-6 right-6 z-10">
                  <div className="bg-black/60 backdrop-blur-xl border border-white/10 px-3 py-1.5 rounded-full flex items-center gap-2">
                    <TrendingUp size={12} className="text-emerald-500" />
                    <span className="text-[10px] font-black">{post.virality_score}%</span>
                  </div>
                </div>

                <div 
                  className={cn(
                    "relative overflow-hidden cursor-pointer",
                    viewMode === "grid" ? "aspect-[16/10]" : "w-full md:w-96 h-56 md:h-full"
                  )}
                  onClick={() => setSelectedPost(post)}
                >
                  <img 
                    src={post.thumbnail_url} 
                    alt={post.title}
                    className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110"
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-60" />
                  <div className="absolute bottom-6 left-6">
                    <div className="flex items-center gap-2 mb-2">
                      {STYLES.find(s => s.id === post.style)?.icon}
                      <span className="text-[10px] font-bold uppercase tracking-widest text-white/60">
                        {STYLES.find(s => s.id === post.style)?.name}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="p-8 flex flex-col flex-1">
                  <h3 className="text-xl font-black leading-tight mb-4 group-hover:text-emerald-400 transition-colors line-clamp-2">
                    {post.title}
                  </h3>
                  <div className="text-sm text-white/40 line-clamp-3 mb-8 flex-1 leading-relaxed">
                    <ReactMarkdown>{post.content}</ReactMarkdown>
                  </div>
                  
                  <div className="flex items-center justify-between pt-6 border-t border-white/5">
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => {
                          navigator.clipboard.writeText(post.content);
                          setCopySuccess(post.id!);
                          setTimeout(() => setCopySuccess(null), 2000);
                        }}
                        className="p-3 bg-white/5 hover:bg-white/10 rounded-2xl transition-all text-white/40 hover:text-emerald-500"
                      >
                        {copySuccess === post.id ? <CheckCircle2 size={18} /> : <Copy size={18} />}
                      </button>
                      <button 
                        onClick={() => handleDelete(post.id)}
                        className="p-3 bg-white/5 hover:bg-red-500/10 rounded-2xl transition-all text-white/40 hover:text-red-500"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => handleShare(post, "facebook")}
                        className="p-3 bg-white/5 hover:bg-[#1877F2]/20 rounded-2xl transition-all text-white/40 hover:text-[#1877F2]"
                        title="Share to Facebook"
                      >
                        <Facebook size={18} />
                      </button>
                      <button 
                        onClick={() => handleShare(post, "instagram")}
                        className="p-3 bg-white/5 hover:bg-[#E4405F]/20 rounded-2xl transition-all text-white/40 hover:text-[#E4405F]"
                        title="Share to Instagram"
                      >
                        <Instagram size={18} />
                      </button>
                      <button 
                        onClick={() => handleShare(post, "whatsapp")}
                        className="p-3 bg-white/5 hover:bg-[#25D366]/20 rounded-2xl transition-all text-white/40 hover:text-[#25D366]"
                        title="Share to WhatsApp"
                      >
                        <MessageSquare size={18} />
                      </button>
                      {navigator.share && (
                        <button 
                          onClick={() => handleShare(post, "native")}
                          className="p-3 bg-white/5 hover:bg-emerald-500/20 rounded-2xl transition-all text-white/40 hover:text-emerald-500"
                          title="More Share Options"
                        >
                          <Share2 size={18} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </main>

      {/* Bulk Gen Modal */}
      <AnimatePresence>
        {showGenModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !isGenerating && setShowGenModal(false)}
              className="absolute inset-0 bg-black/90 backdrop-blur-2xl"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-2xl bg-[#111] border border-white/10 rounded-[3rem] p-12 shadow-2xl overflow-hidden"
            >
              {isGenerating && (
                <div className="absolute inset-0 z-10 bg-black/60 backdrop-blur-md flex flex-col items-center justify-center p-12 text-center">
                  <div className="relative w-32 h-32 mb-8">
                    <svg className="w-full h-full rotate-[-90deg]">
                      <circle 
                        cx="64" cy="64" r="60" 
                        fill="none" stroke="white" strokeWidth="8" strokeOpacity="0.1" 
                      />
                      <circle 
                        cx="64" cy="64" r="60" 
                        fill="none" stroke="#10b981" strokeWidth="8" 
                        strokeDasharray="377" 
                        strokeDashoffset={377 - (377 * progress) / 100}
                        strokeLinecap="round"
                        className="transition-all duration-500"
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Sparkles className="text-emerald-500 animate-pulse" size={32} />
                    </div>
                  </div>
                  <h3 className="text-2xl font-black mb-2">Architecting Your Empire</h3>
                  <p className="text-white/40 text-sm max-w-xs">Gemini is analyzing your samples to generate {genConfig.count} high-performance insights.</p>
                </div>
              )}

              <div className="flex items-center gap-4 mb-10">
                <div className="w-14 h-14 bg-emerald-500 rounded-2xl flex items-center justify-center text-black shadow-xl shadow-emerald-500/20">
                  <Wand2 size={28} />
                </div>
                <div>
                  <h2 className="text-3xl font-black tracking-tight">Bulk Generator</h2>
                  <p className="text-sm text-white/40 font-medium">Scale your content bank with AI precision.</p>
                </div>
              </div>

              <div className="space-y-8">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/30 mb-3 block">Primary Theme</label>
                  <input 
                    type="text" 
                    placeholder="e.g., AI Automation for Freelancers, High-Ticket Closing..."
                    className="w-full px-8 py-5 bg-white/5 border border-white/10 rounded-[1.5rem] text-lg font-medium focus:ring-2 focus:ring-emerald-500/50 outline-none transition-all placeholder:text-white/10"
                    value={genConfig.topic}
                    onChange={(e) => setGenConfig({ ...genConfig, topic: e.target.value })}
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/30 mb-4 block">Writing Style</label>
                  <div className="grid grid-cols-2 gap-3">
                    {STYLES.map((style) => (
                      <button
                        key={style.id}
                        onClick={() => setGenConfig({ ...genConfig, style: style.id })}
                        className={cn(
                          "flex items-center gap-3 p-4 rounded-2xl border transition-all text-left",
                          genConfig.style === style.id 
                            ? "bg-emerald-500 border-emerald-500 text-black shadow-lg shadow-emerald-500/20" 
                            : "bg-white/5 border-white/10 text-white/60 hover:border-white/20"
                        )}
                      >
                        {style.icon}
                        <div>
                          <p className="text-xs font-black">{style.name}</p>
                          <p className={cn("text-[9px] font-medium opacity-60", genConfig.style === style.id ? "text-black" : "text-white")}>
                            {style.description}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-8">
                  <div className="flex-1">
                    <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/30 mb-4 block">Batch Size (1-100)</label>
                    <div className="flex items-center gap-4">
                      <input 
                        type="range" min="1" max="100" step="1"
                        className="flex-1 accent-emerald-500 h-1 bg-white/10 rounded-full appearance-none"
                        value={genConfig.count}
                        onChange={(e) => setGenConfig({ ...genConfig, count: parseInt(e.target.value) })}
                      />
                      <input 
                        type="number"
                        min="1"
                        max="1000"
                        className="w-20 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-center font-black text-sm"
                        value={genConfig.count}
                        onChange={(e) => setGenConfig({ ...genConfig, count: Math.min(1000, Math.max(1, parseInt(e.target.value) || 1)) })}
                      />
                    </div>
                  </div>
                  
                  <button 
                    onClick={handleBulkGenerate}
                    className="px-10 py-5 bg-emerald-500 text-black rounded-2xl font-black text-sm hover:bg-emerald-400 transition-all active:scale-95 shadow-xl shadow-emerald-500/20"
                  >
                    Start Generation
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Detail Modal */}
      <AnimatePresence>
        {selectedPost && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-12">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedPost(null)}
              className="absolute inset-0 bg-black/95 backdrop-blur-3xl"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-6xl bg-[#111] border border-white/10 rounded-[3.5rem] overflow-hidden shadow-2xl flex flex-col md:flex-row max-h-[90vh]"
            >
              <div className="w-full md:w-1/2 h-72 md:h-auto relative">
                <img 
                  src={selectedPost.thumbnail_url} 
                  alt={selectedPost.title}
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-0 bg-gradient-to-r from-black/40 to-transparent" />
                <div className="absolute bottom-10 left-10">
                  <div className="flex items-center gap-3 bg-black/60 backdrop-blur-xl border border-white/10 px-5 py-2 rounded-full">
                    <TrendingUp size={16} className="text-emerald-500" />
                    <span className="text-xs font-black tracking-widest uppercase">Predicted Virality: {selectedPost.virality_score}%</span>
                  </div>
                </div>
              </div>
              
              <div className="w-full md:w-1/2 p-12 md:p-16 flex flex-col overflow-y-auto">
                <div className="flex justify-between items-start mb-10">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-500">
                        {STYLES.find(s => s.id === selectedPost.style)?.icon}
                      </div>
                      <span className="text-[10px] font-black uppercase tracking-[0.3em] text-white/40">
                        {STYLES.find(s => s.id === selectedPost.style)?.name} Insight
                      </span>
                    </div>
                    {isEditing ? (
                      <input 
                        type="text"
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-2xl font-black outline-none focus:ring-1 focus:ring-emerald-500"
                        value={editedTitle}
                        onChange={(e) => setEditedTitle(e.target.value)}
                      />
                    ) : (
                      <h2 className="text-4xl font-black leading-[1.1] tracking-tight">{selectedPost.title}</h2>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => {
                        if (isEditing) {
                          handleSaveEdit();
                        } else {
                          setEditedTitle(selectedPost.title);
                          setEditedContent(selectedPost.content);
                          setIsEditing(true);
                        }
                      }}
                      className="p-3 bg-white/5 hover:bg-white/10 rounded-2xl transition-colors text-white/20 hover:text-white"
                      title={isEditing ? "Save" : "Edit"}
                    >
                      {isEditing ? <CheckCircle2 size={24} className="text-emerald-500" /> : <Settings2 size={24} />}
                    </button>
                    <button 
                      onClick={() => setSelectedPost(null)}
                      className="p-3 hover:bg-white/5 rounded-2xl transition-colors text-white/20 hover:text-white"
                    >
                      <X size={28} />
                    </button>
                  </div>
                </div>

                <div className="prose prose-invert prose-emerald max-w-none text-white/60 flex-1 mb-12 leading-relaxed text-lg">
                  {isEditing ? (
                    <textarea 
                      className="w-full h-64 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-lg outline-none focus:ring-1 focus:ring-emerald-500 resize-none"
                      value={editedContent}
                      onChange={(e) => setEditedContent(e.target.value)}
                    />
                  ) : (
                    <ReactMarkdown>{selectedPost.content}</ReactMarkdown>
                  )}
                </div>

                {/* AI Tools Section */}
                {!isEditing && (
                  <div className="mb-8 grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <button 
                      onClick={handleOptimize}
                      disabled={isOptimizing}
                      className="flex items-center justify-center gap-2 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-500/20 transition-all"
                    >
                      {isOptimizing ? <Loader2 className="animate-spin" size={14} /> : <TrendingUp size={14} />}
                      Optimize
                    </button>
                    <button 
                      onClick={() => handleTranslate("Swahili")}
                      disabled={isTranslating}
                      className="flex items-center justify-center gap-2 p-4 bg-white/5 border border-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-white/10 transition-all"
                    >
                      {isTranslating ? <Loader2 className="animate-spin" size={14} /> : <BrainCircuit size={14} />}
                      Swahili
                    </button>
                    <button 
                      onClick={() => handleTranslate("French")}
                      disabled={isTranslating}
                      className="flex items-center justify-center gap-2 p-4 bg-white/5 border border-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-white/10 transition-all"
                    >
                      {isTranslating ? <Loader2 className="animate-spin" size={14} /> : <BrainCircuit size={14} />}
                      French
                    </button>
                    <button 
                      onClick={() => {
                        const prompt = selectedPost.thumbnail_prompt || "No prompt stored";
                        navigator.clipboard.writeText(prompt);
                        alert("Thumbnail prompt copied! You can use this in Midjourney or DALL-E.");
                      }}
                      className="flex items-center justify-center gap-2 p-4 bg-white/5 border border-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-white/10 transition-all"
                    >
                      <Copy size={14} />
                      Copy Prompt
                    </button>
                  </div>
                )}

                {/* Custom Thumbnail Prompt Section */}
                <div className="mb-8 p-6 bg-white/5 border border-white/10 rounded-3xl">
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/30 block">Custom Thumbnail Prompt</label>
                    <button 
                      onClick={() => {
                        const prompt = selectedPost.thumbnail_prompt || "No prompt stored";
                        navigator.clipboard.writeText(prompt);
                        alert("Thumbnail prompt copied!");
                      }}
                      className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest hover:text-emerald-400"
                    >
                      Copy Current
                    </button>
                  </div>
                  <div className="flex gap-3">
                    <input 
                      type="text" 
                      placeholder="Describe your perfect thumbnail..."
                      className="flex-1 px-4 py-3 bg-black border border-white/10 rounded-xl text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
                      value={customThumbPrompt}
                      onChange={(e) => setCustomThumbPrompt(e.target.value)}
                    />
                    <button 
                      onClick={() => handleRegenerateThumbnail(selectedPost)}
                      disabled={isRegeneratingThumb}
                      className="px-4 py-3 bg-emerald-500 text-black rounded-xl font-bold text-xs hover:bg-emerald-400 transition-all disabled:opacity-50"
                    >
                      {isRegeneratingThumb ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}
                    </button>
                  </div>
                </div>

                {/* Reminder Section */}
                <div className="mb-8 p-6 bg-white/5 border border-white/10 rounded-3xl">
                  <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/30 mb-3 block">Schedule Reminder</label>
                  <div className="flex gap-3">
                    <input 
                      type="datetime-local" 
                      className="flex-1 px-4 py-3 bg-black border border-white/10 rounded-xl text-sm focus:ring-1 focus:ring-emerald-500 outline-none text-white"
                      value={reminderTime}
                      onChange={(e) => setReminderTime(e.target.value)}
                    />
                    <button 
                      onClick={() => handleSetReminder(selectedPost)}
                      className="px-4 py-3 bg-white text-black rounded-xl font-bold text-xs hover:bg-white/90 transition-all"
                    >
                      Set
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <button 
                    onClick={() => {
                      navigator.clipboard.writeText(selectedPost.content);
                      setCopySuccess(selectedPost.id!);
                      setTimeout(() => setCopySuccess(null), 2000);
                    }}
                    className="flex items-center justify-center gap-3 py-5 bg-white text-black rounded-3xl font-black text-sm hover:bg-white/90 transition-all active:scale-95"
                  >
                    {copySuccess === selectedPost.id ? <CheckCircle2 size={20} /> : <Copy size={20} />}
                    <span>{copySuccess === selectedPost.id ? "Copied to Clipboard" : "Copy Content"}</span>
                  </button>
                  <div className="flex gap-3">
                    <button 
                      onClick={() => handleDownloadImage(selectedPost)}
                      className="flex-1 flex items-center justify-center bg-white/5 border border-white/10 rounded-3xl hover:bg-white/10 transition-all"
                      title="Download Thumbnail"
                    >
                      <Download size={24} />
                    </button>
                    <button 
                      onClick={() => handleRegenerateThumbnail(selectedPost)}
                      className="flex-1 flex items-center justify-center bg-white/5 border border-white/10 rounded-3xl hover:bg-emerald-500/20 hover:text-emerald-500 transition-all"
                      title="Regenerate Thumbnail"
                    >
                      <RefreshCw size={24} />
                    </button>
                    <button 
                      onClick={() => handleShare(selectedPost, "facebook")}
                      className="flex-1 flex items-center justify-center bg-white/5 border border-white/10 rounded-3xl hover:bg-[#1877F2]/20 hover:text-[#1877F2] transition-all"
                      title="Share to Facebook"
                    >
                      <Facebook size={24} />
                    </button>
                    <button 
                      onClick={() => handleShare(selectedPost, "instagram")}
                      className="flex-1 flex items-center justify-center bg-white/5 border border-white/10 rounded-3xl hover:bg-[#E4405F]/20 hover:text-[#E4405F] transition-all"
                      title="Share to Instagram"
                    >
                      <Instagram size={24} />
                    </button>
                    <button 
                      onClick={() => handleShare(selectedPost, "whatsapp")}
                      className="flex-1 flex items-center justify-center bg-white/5 border border-white/10 rounded-3xl hover:bg-[#25D366]/20 hover:text-[#25D366] transition-all"
                      title="Share to WhatsApp"
                    >
                      <MessageSquare size={24} />
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

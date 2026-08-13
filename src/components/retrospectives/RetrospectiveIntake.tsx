import React, { useState, useEffect, useRef } from "react";
import {
  type SprintSnapshot,
  type Retrospective,
  type SupportingMeeting,
  type ModelDescribeResult,
  type RetroAnalysisProgress,
  type CoachTopic,
  type Project,
  retroClient,
} from "../../services/retro/client";
import {
  AlertCircle,
  FileText,
  UploadCloud,
  CheckCircle2,
  Edit3,
  Loader2,
  Sparkles,
  Settings,
  X,
  Plus,
  Clock,
  Layers,
  ChevronDown,
  ChevronUp,
  Calendar,
  FolderOpen,
} from "lucide-react";
import { Button } from "../ui/button";

import { useSettingsStore } from "../../stores/settingsStore";
import { parseVttToTranscript } from "../../utils/vttParser";

interface RetrospectiveIntakeProps {
  sprints: SprintSnapshot[];
  currentProject?: Project | null;
  uploaderIdentity?: string;
  onSprintUpdate: () => void;
  onAnalysisSuccess: (retroId: string) => void;
  onOpenSettings: () => void;
}

export default function RetrospectiveIntake({
  sprints,
  currentProject,
  uploaderIdentity,
  onSprintUpdate,
  onAnalysisSuccess,
  onOpenSettings,
}: RetrospectiveIntakeProps) {
  const [selectedSprintId, setSelectedSprintId] = useState<string>(sprints[0]?.id || "sprint-23");
  const [transcriptText, setTranscriptText] = useState<string>("");
  const [sourceKind, setSourceKind] = useState<"audio" | "text" | "paste">("paste");
  const [audioFileName, setAudioFileName] = useState<string | null>(null);
  const [audioSourcePath, setAudioSourcePath] = useState<string | null>(null);

  // Supporting Sprint Meetings state
  const [supportingMeetings, setSupportingMeetings] = useState<SupportingMeeting[]>([]);
  const [isSupportingOpen, setIsSupportingOpen] = useState<boolean>(true);

  const [modelStatus, setModelStatus] = useState<ModelDescribeResult | null>(null);
  const [isCheckingModel, setIsCheckingModel] = useState<boolean>(true);

  const [coachTopics, setCoachTopics] = useState<CoachTopic[]>([]);
  const [isGeneratingTopics, setIsGeneratingTopics] = useState<boolean>(false);

  useEffect(() => {
    if (selectedSprintId) {
      loadTopicsForSprint(selectedSprintId);
    }
  }, [selectedSprintId, currentProject?.id]);

  const loadTopicsForSprint = async (sprintId: string) => {
    try {
      const list = await retroClient.listTopics(currentProject?.id || undefined, sprintId);
      setCoachTopics(list || []);
    } catch (err) {
      console.warn("Failed to load topics for sprint", err);
    }
  };

  const handleSuggestTopics = async () => {
    if (!selectedSprintId) return;
    setIsGeneratingTopics(true);
    try {
      const list = await retroClient.suggestCoachTopics(currentProject?.id || undefined, selectedSprintId);
      setCoachTopics(list || []);
    } catch (err) {
      console.error("Failed to suggest topics", err);
    } finally {
      setIsGeneratingTopics(false);
    }
  };

  const [showDismissedTopics, setShowDismissedTopics] = useState<boolean>(false);

  const handleToggleTopicState = async (topicId: string, currentState: string) => {
    const nextState = currentState === "accepted" ? "suggested" : "accepted";
    try {
      await retroClient.updateTopic(topicId, { state: nextState });
      loadTopicsForSprint(selectedSprintId);
    } catch (err) {
      console.error("Failed to update topic state", err);
    }
  };

  const handleDismissTopic = async (topicId: string) => {
    try {
      await retroClient.updateTopic(topicId, { state: "dismissed" });
      loadTopicsForSprint(selectedSprintId);
    } catch (err) {
      console.error("Failed to dismiss topic", err);
    }
  };

  const handleRestoreTopic = async (topicId: string) => {
    try {
      await retroClient.updateTopic(topicId, { state: "suggested" });
      loadTopicsForSprint(selectedSprintId);
    } catch (err) {
      console.error("Failed to restore topic", err);
    }
  };

  const retroAnalystMode = useSettingsStore((s) => s.retroAnalystMode);
  const retroAnalystProvider = useSettingsStore((s) => s.retroAnalystProvider);
  const retroAnalystModel = useSettingsStore((s) => s.retroAnalystModel);
  const retroReasoningModel = useSettingsStore((s) => s.retroReasoningModel);
  const cleanupModel = useSettingsStore((s) => s.cleanupModel);
  const cleanupProvider = useSettingsStore((s) => s.cleanupProvider);
  const cleanupMode = useSettingsStore((s) => s.cleanupMode);

  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [progressState, setProgressState] = useState<RetroAnalysisProgress | null>(null);
  const [currentRetroId, setCurrentRetroId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Edit Sprint Metrics Modal state
  const [showEditSprintModal, setShowEditSprintModal] = useState<boolean>(false);
  const [editSprintData, setEditSprintData] = useState<Partial<SprintSnapshot>>({});
  const [isNewSprint, setIsNewSprint] = useState<boolean>(false);

  const bottomRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    setTimeout(() => {
      if (bottomRef.current) {
        bottomRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
        const scrollParent = bottomRef.current.closest(".overflow-y-auto");
        if (scrollParent) {
          scrollParent.scrollTo({
            top: scrollParent.scrollHeight,
            behavior: "smooth",
          });
        }
      }
    }, 100);
  };

  useEffect(() => {
    if (isAnalyzing) {
      scrollToBottom();
    }
  }, [isAnalyzing]);

  const selectedSprint = sprints.find((s) => s.id === selectedSprintId) || sprints[0];

  const isSelectedSprintActive = (() => {
    if (!selectedSprint) return false;
    if (sprints[0] && selectedSprint.id === sprints[0].id) return true;
    if (selectedSprint.end_date) {
      const endDate = new Date(selectedSprint.end_date);
      if (endDate > new Date()) return true;
    }
    return false;
  })();

  useEffect(() => {
    let isMounted = true;
    retroClient
      .describeModel({
        retroAnalystMode,
        retroAnalystProvider,
        retroAnalystModel,
        retroReasoningModel,
        cleanupModel,
        cleanupProvider,
        cleanupMode,
      })
      .then((res) => {
        if (isMounted) {
          setModelStatus(res);
          setIsCheckingModel(false);
        }
      })
      .catch(() => {
        if (isMounted) {
          setModelStatus({ available: false, modelId: null, providerId: "local", contextLength: 4096 });
          setIsCheckingModel(false);
        }
      });

    const cleanupProgress = retroClient.onAnalysisProgress((data) => {
      setProgressState(data);
      if (data.stage === "completed") {
        setIsAnalyzing(false);
        if (data.retrospectiveId) {
          onAnalysisSuccess(data.retrospectiveId);
        }
      } else if (data.stage === "error") {
        setIsAnalyzing(false);
        setErrorMessage(data.error || "Analysis failed");
      }
    });

    return () => {
      isMounted = false;
      cleanupProgress();
    };
  }, [onAnalysisSuccess, retroAnalystMode, retroAnalystProvider, retroAnalystModel, retroReasoningModel, cleanupModel, cleanupProvider, cleanupMode]);

  const handleNewSprintOpen = () => {
    const nextNum =
      sprints.reduce((max, s) => {
        const num = parseInt(s.id.replace(/[^0-9]/g, ""), 10);
        return isNaN(num) ? max : Math.max(max, num);
      }, 22) + 1;

    setEditSprintData({
      id: `sprint-${nextNum}`,
      name: `Sprint ${nextNum} — Payments`,
      start_date: new Date().toISOString().split("T")[0],
      end_date: new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0],
      committed_points: 40,
      completed_points: 32,
      total_issues: 12,
      completed_issues: 10,
      blocked_issues: 1,
      burndown_trend: "on_track",
      velocity: 35,
      blockers: "",
    });
    setIsNewSprint(true);
    setShowEditSprintModal(true);
  };

  const handleEditSprintOpen = () => {
    if (selectedSprint) {
      setEditSprintData({ ...selectedSprint });
      setIsNewSprint(false);
      setShowEditSprintModal(true);
    }
  };

  const handleSaveSprintMetrics = async () => {
    if (!editSprintData.id) return;
    try {
      await retroClient.updateSprintMetrics(editSprintData.id, editSprintData);
      await onSprintUpdate();
      setSelectedSprintId(editSprintData.id);
      setShowEditSprintModal(false);
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to update sprint metrics");
    }
  };

  const handleBatchFileUpload = (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    fileArray.forEach((file) => {
      const isTxt = file.name.toLowerCase().endsWith(".txt");
      const isVtt = file.name.toLowerCase().endsWith(".vtt");
      const isMd = file.name.toLowerCase().endsWith(".md");
      const isAudio = file.type.startsWith("audio/") || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name);

      if (isAudio) {
        if (!audioFileName && !transcriptText) {
          setAudioFileName(file.name);
          const filePath = (file as any).path || file.name;
          setAudioSourcePath(filePath);
          setSourceKind("audio");
          setTranscriptText(`[Audio File: ${file.name} - Ready for analysis]`);
        }
      } else if (isTxt || isVtt || isMd) {
        const reader = new FileReader();
        reader.onload = (e) => {
          const raw = e.target?.result as string;
          const cleanText = isVtt ? parseVttToTranscript(raw) : raw;

          if (!audioFileName && (!transcriptText || sourceKind === "paste")) {
            setTranscriptText(cleanText);
            setSourceKind("text");
            setAudioFileName(file.name);
          } else {
            const wordCount = cleanText.trim().split(/\s+/).filter(Boolean).length;
            const meeting: SupportingMeeting = {
              id: `sm-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
              title: file.name.replace(/\.(txt|vtt|md)$/i, ""),
              transcript: cleanText,
              sourceKind: "text",
              fileName: file.name,
              wordCount,
              meetingDate: new Date().toISOString().split("T")[0],
            };
            setSupportingMeetings((prev) => [...prev, meeting]);
          }
        };
        reader.readAsText(file);
      }
    });
  };

  const handlePromoteToPrimaryRetro = (meeting: SupportingMeeting) => {
    if (transcriptText && sourceKind !== "audio") {
      const demotedMeeting: SupportingMeeting = {
        id: `sm-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        title: audioFileName ? audioFileName.replace(/\.(txt|vtt|md)$/i, "") : "Previous Retro Transcript",
        transcript: transcriptText,
        sourceKind: "text",
        fileName: audioFileName || undefined,
        wordCount: transcriptText.trim().split(/\s+/).filter(Boolean).length,
        meetingDate: new Date().toISOString().split("T")[0],
      };
      setSupportingMeetings((prev) => [...prev.filter((m) => m.id !== meeting.id), demotedMeeting]);
    } else {
      setSupportingMeetings((prev) => prev.filter((m) => m.id !== meeting.id));
    }

    setTranscriptText(meeting.transcript);
    setSourceKind("text");
    setAudioFileName(meeting.title);
    setAudioSourcePath(null);
  };

  const handleRemoveSupportingMeeting = (id: string) => {
    setSupportingMeetings((prev) => prev.filter((m) => m.id !== id));
  };

  const handleUpdateSupportingTitle = (id: string, newTitle: string) => {
    setSupportingMeetings((prev) =>
      prev.map((m) => (m.id === id ? { ...m, title: newTitle } : m))
    );
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleBatchFileUpload(e.dataTransfer.files);
    }
  };

  const handleStartAnalysis = async () => {
    if (!selectedSprintId || !transcriptText.trim()) {
      setErrorMessage("Please select a sprint and provide transcript text.");
      return;
    }

    setErrorMessage(null);
    setIsAnalyzing(true);

    try {
      // Create retrospective entry
      const retro = await retroClient.createRetro({
        sprintId: selectedSprintId,
        transcript: transcriptText,
        sourceKind: sourceKind,
        audioPath: audioSourcePath || undefined,
        meetingOwner: uploaderIdentity || undefined,
        supportingMeetings: supportingMeetings.length > 0 ? supportingMeetings : undefined,
      });

      setCurrentRetroId(retro.id);

      // Copy audio if audio file
      if (audioSourcePath) {
        try {
          const { copiedPath } = await retroClient.copyRetroAudio(audioSourcePath, retro.id);
          await retroClient.updateRetro(retro.id, { audio_path: copiedPath });
        } catch (copyErr) {
          console.warn("Audio copy failed", copyErr);
        }
      }

      // Run analysis
      await retroClient.runAnalysis(retro.id);
    } catch (err: any) {
      setIsAnalyzing(false);
      setErrorMessage(err.message || "Failed to start analysis.");
    }
  };

  const handleCancelAnalysis = async () => {
    if (currentRetroId) {
      await retroClient.cancelAnalysis(currentRetroId);
    }
    setIsAnalyzing(false);
    setProgressState(null);
  };

  return (
    <div className="space-y-6">

      {errorMessage && (
        <div className="p-3.5 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Sprint Selection */}
      <div className="space-y-2 rounded-xl border border-border/40 bg-surface-1/40 p-4">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Sprint <span className="text-destructive">*</span>
          </label>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          <select
            value={selectedSprintId}
            onChange={(e) => setSelectedSprintId(e.target.value)}
            className="h-9 w-full sm:w-72 rounded-md border border-border/60 bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {sprints.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          {selectedSprint && (
            <div className="text-xs text-muted-foreground space-x-2">
              <span>
                {selectedSprint.start_date} – {selectedSprint.end_date}
              </span>
              <span>·</span>
              <span className="font-medium text-foreground">
                {selectedSprint.total_issues > 0
                  ? Math.round((selectedSprint.completed_issues / selectedSprint.total_issues) * 100)
                  : 0}
                % complete
              </span>
              <span>·</span>
              <span className="text-destructive font-medium">
                {selectedSprint.blocked_issues} blockers
              </span>
              <span>·</span>
              <span>Burndown: {selectedSprint.burndown_trend}</span>
            </div>
          )}
        </div>
      </div>

      {/* Step 2: AI Coach Suggested Discussion Topics */}
      <div className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="text-amber-500" size={16} />
            <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
              Coach Suggested Agenda
            </h4>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={handleSuggestTopics}
            disabled={isGeneratingTopics}
            className="h-7 text-xs font-semibold gap-1 bg-background hover:bg-surface-1"
          >
            {isGeneratingTopics ? (
              <>
                <Loader2 size={12} className="animate-spin" /> Generating...
              </>
            ) : (
              <>
                <Sparkles size={12} className="text-amber-500" /> Suggest Topics
              </>
            )}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Review discussion topics proposed by the Agile Coach Agent based on sprint metrics and carried actions. Accept topics to set the retro agenda.
        </p>

        {coachTopics.length === 0 ? (
          <div className="p-3 text-center border border-dashed border-border/60 rounded-lg text-xs text-muted-foreground">
            No discussion topics generated for this sprint yet. Click <strong>Suggest Topics</strong> above to let the AI Coach analyze sprint metrics.
          </div>
        ) : (
          <div className="space-y-2">
            {coachTopics
              .filter((topic) => showDismissedTopics || topic.state !== "dismissed")
              .map((topic) => (
                <div
                  key={topic.id}
                  className={`p-3 rounded-lg border text-xs space-y-1 transition-all ${
                    topic.state === "dismissed"
                      ? "border-border/30 bg-background/40 opacity-60"
                      : topic.state === "accepted"
                      ? "border-emerald-500/40 bg-emerald-500/10"
                      : "border-border/50 bg-background"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-0.5 min-w-0 flex-1">
                      <span className="font-semibold text-foreground flex items-center gap-1.5">
                        {topic.state === "accepted" && <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />}
                        <span className={topic.state === "dismissed" ? "line-through text-muted-foreground" : ""}>
                          {topic.title}
                        </span>
                      </span>
                      <p className="text-muted-foreground">{topic.rationale}</p>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {topic.state === "dismissed" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRestoreTopic(topic.id)}
                          className="h-6 text-[11px] px-2 font-semibold text-muted-foreground hover:text-foreground"
                        >
                          Restore
                        </Button>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant={topic.state === "accepted" ? "default" : "outline"}
                            onClick={() => handleToggleTopicState(topic.id, topic.state)}
                            className={`h-6 text-[11px] px-2 font-semibold ${
                              topic.state === "accepted"
                                ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {topic.state === "accepted" ? "Accepted" : "Accept Topic"}
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleDismissTopic(topic.id)}
                            className="h-6 w-6 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            title="Dismiss topic"
                          >
                            <X size={13} />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}

            {coachTopics.some((t) => t.state === "dismissed") && (
              <div className="pt-1 flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowDismissedTopics((prev) => !prev)}
                  className="text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showDismissedTopics
                    ? "Hide dismissed topics"
                    : `Show ${coachTopics.filter((t) => t.state === "dismissed").length} dismissed topic${
                        coachTopics.filter((t) => t.state === "dismissed").length === 1 ? "" : "s"
                      }`}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Active Sprint Notice vs Transcript Section */}
      {isSelectedSprintActive ? (
        <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-5 text-center space-y-2 shadow-2xs">
          <div className="flex items-center justify-center gap-2 text-blue-600 dark:text-blue-400 font-semibold text-sm">
            <Clock size={16} />
            <span>{selectedSprint?.name} is currently in progress</span>
          </div>
          <p className="text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">
            This sprint is active through <strong>{selectedSprint?.end_date || "end of sprint"}</strong>. Retrospective transcript upload and analysis will open once this sprint has completed.
          </p>
        </div>
      ) : (
        <>
          {/* Unified Sprint Transcripts & Meeting Context Section */}
          <div className="space-y-4 rounded-xl border border-border/60 bg-surface-1/30 p-5 shadow-2xs">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-2">
                <Layers size={16} className="text-primary" />
                Sprint Transcripts & Meeting Context
              </h4>
              <p className="text-xs text-muted-foreground mt-0.5">
                Upload audio or transcripts for your primary retrospective and any supporting sprint meetings (standups, spec syncs, notes). You can drop multiple files at once.
              </p>
            </div>

            {/* Unified Multi-File Dropzone */}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleFileDrop}
              className="border-2 border-dashed border-border/60 hover:border-primary/50 rounded-xl p-5 text-center bg-background/60 transition-colors flex flex-col items-center justify-center gap-2"
            >
              <UploadCloud className="w-8 h-8 text-primary/80" />
              <div className="text-sm font-medium text-foreground">
                Drop audio (.mp3, .wav, .m4a) or transcript (.txt, .vtt, .md) files here
              </div>
              <p className="text-xs text-muted-foreground max-w-md">
                Files remain entirely on your device. Drop multiple files together to upload retrospective and standup logs at once.
              </p>
              <div className="flex items-center gap-3 mt-1">
                <label className="cursor-pointer">
                  <span className="inline-flex items-center justify-center h-8 px-4 rounded-md bg-secondary text-secondary-foreground text-xs font-medium hover:bg-secondary/80 transition-colors">
                    Browse files
                  </span>
                  <input
                    type="file"
                    multiple
                    accept=".txt,.vtt,.md,audio/*"
                    onChange={(e) => e.target.files?.length && handleBatchFileUpload(e.target.files)}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            {/* Unified List of Uploaded Meetings & Transcripts */}
            {(audioFileName || transcriptText || supportingMeetings.length > 0) && (
              <div className="space-y-2 pt-1">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block px-0.5">
                  Uploaded Sprint Files ({(audioFileName || transcriptText ? 1 : 0) + supportingMeetings.length})
                </label>

                {/* Primary Retro Item Card */}
                {(audioFileName || transcriptText) && (
                  <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 flex items-center justify-between gap-3 shadow-2xs">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="h-8 w-8 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                        <FileText size={16} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={audioFileName || "Primary Retrospective Transcript"}
                            onChange={(e) => setAudioFileName(e.target.value)}
                            className="text-xs font-semibold text-foreground bg-transparent border-b border-transparent hover:border-border focus:border-primary focus:outline-none truncate"
                            placeholder="Primary Retro Title..."
                          />
                          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 shrink-0">
                            Primary Retro (Never Summarized)
                          </span>
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-background/80 text-muted-foreground shrink-0 border border-border/40">
                            {sourceKind === "audio"
                              ? "Audio"
                              : audioFileName?.toLowerCase().endsWith(".vtt")
                              ? "VTT"
                              : audioFileName?.toLowerCase().endsWith(".md")
                              ? "MD"
                              : "Text"}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground truncate">
                          Authoritative primary analysis source · ~
                          {transcriptText.trim().split(/\s+/).filter(Boolean).length.toLocaleString()} words
                        </p>
                      </div>
                    </div>

                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                      title="Remove Primary Retro"
                      onClick={() => {
                        setAudioFileName(null);
                        setAudioSourcePath(null);
                        setTranscriptText("");
                        setSourceKind("paste");
                      }}
                    >
                      <X size={14} />
                    </Button>
                  </div>
                )}

                {/* Supporting Meeting Cards */}
                {supportingMeetings.map((meeting) => (
                  <div
                    key={meeting.id}
                    className="p-3 rounded-xl border border-border/50 bg-background flex items-center justify-between gap-3 text-xs shadow-2xs"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="h-8 w-8 rounded-lg bg-surface-2 text-muted-foreground flex items-center justify-center shrink-0">
                        <FileText size={16} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={meeting.title}
                            onChange={(e) => handleUpdateSupportingTitle(meeting.id, e.target.value)}
                            className="text-xs font-semibold text-foreground bg-transparent border-b border-transparent hover:border-border focus:border-primary focus:outline-none truncate"
                            placeholder="Meeting title..."
                          />
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                            Supporting Context
                          </span>
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground shrink-0">
                            {meeting.sourceKind === "paste" ? "Pasted" : meeting.fileName?.endsWith(".vtt") ? "VTT" : meeting.fileName?.endsWith(".md") ? "MD" : "TXT"}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground truncate">
                          Supporting meeting context · ~{meeting.wordCount || 0} words
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handlePromoteToPrimaryRetro(meeting)}
                        className="h-7 text-[11px] px-2.5 font-medium border-border/60 hover:border-emerald-500/50 hover:bg-emerald-500/10 hover:text-emerald-600 transition-colors"
                        title="Set this file as the primary retrospective transcript"
                      >
                        Set as Primary Retro
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleRemoveSupportingMeeting(meeting.id)}
                        className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                        title="Remove meeting"
                      >
                        <X size={14} />
                      </Button>
                    </div>
                  </div>
                ))}

                {/* Combined Token Context Budget Bar */}
                <div className="pt-1 flex items-center justify-between text-[11px] text-muted-foreground px-1">
                  <span>
                    Total Context: ~
                    {(
                      (transcriptText ? transcriptText.trim().split(/\s+/).filter(Boolean).length : 0) +
                      supportingMeetings.reduce((sum, m) => sum + (m.wordCount || 0), 0)
                    ).toLocaleString()}{" "}
                    words across {(transcriptText ? 1 : 0) + supportingMeetings.length} file
                    {(transcriptText ? 1 : 0) + supportingMeetings.length === 1 ? "" : "s"}
                  </span>
                  <span className="text-primary/80 font-medium">
                    Primary Retro is passed in full · Supporting context scales to model limit
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Primary Retro Transcript Textarea */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
              <span>Primary Retrospective Transcript (Editable)</span>
              <span className="text-[10px] normal-case text-muted-foreground font-normal">
                This main retro transcript is analyzed in full and will never be summarized or truncated.
              </span>
            </label>
            <textarea
              value={transcriptText}
              onChange={(e) => {
                setTranscriptText(e.target.value);
                setSourceKind("paste");
              }}
              placeholder="Paste or edit the retrospective discussion transcript here..."
              rows={10}
              className="w-full rounded-xl border border-border/60 bg-background p-4 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary leading-relaxed"
            />
          </div>

          {/* Model Status / Warning */}
          {!isCheckingModel && modelStatus && !modelStatus.available && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1">
                <h4 className="font-semibold text-amber-600 dark:text-amber-400">
                  No reasoning model configured
                </h4>
                <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
                  No valid model is selected or available for Retrospective Analyst. Please configure a local or cloud provider in settings.
                </p>
                <div className="pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onOpenSettings}
                    className="h-7 text-xs border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10 gap-1.5"
                  >
                    <Settings size={12} /> Open model settings
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Model Info & Action Button */}
          <div className="space-y-3 pt-2">
            {!isAnalyzing ? (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="text-xs text-muted-foreground flex items-center gap-2">
                  <Sparkles size={14} className="text-primary" />
                  <span>
                    Model:{" "}
                    <strong className="text-foreground font-medium">
                      {modelStatus?.modelId ||
                        (retroAnalystMode === "providers" || retroAnalystProvider === "gemini"
                          ? `Google Gemini${retroAnalystModel ? ` (${retroAnalystModel})` : ""}`
                          : "Qwen2.5 7B (local)")}
                    </strong>
                  </span>
                </div>

                <Button
                  onClick={handleStartAnalysis}
                  disabled={!modelStatus?.available || !transcriptText.trim()}
                  className="w-full sm:w-auto h-10 px-6 font-medium gap-2 shadow-sm"
                >
                  <Sparkles size={16} /> Analyze retrospective
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="w-full rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 text-primary animate-spin" />
                      <span className="text-sm font-semibold text-foreground">
                        Analyzing retrospective…
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCancelAnalysis}
                      className="h-7 text-xs text-destructive hover:bg-destructive/10"
                    >
                      Cancel
                    </Button>
                  </div>
                  {progressState && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>
                          {progressState.stage === "parsing" ? "Repairing JSON schema..." : "Processing chunk"}
                        </span>
                        <span>
                          Chunk {progressState.chunkIndex || 1} of {progressState.chunkCount || 1}
                        </span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-border/40 overflow-hidden">
                        <div
                          className="h-full bg-primary transition-all duration-300"
                      style={{
                        width: `${Math.round(
                          ((progressState.chunkIndex || 1) / (progressState.chunkCount || 1)) * 100
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              )}
              <p className="text-xs text-muted-foreground italic">
                Dictation cleanup is paused while this runs.
              </p>
            </div>

            <div className="text-xs text-muted-foreground flex items-center gap-2 px-1">
              <Sparkles size={14} className="text-primary" />
              <span>
                Model:{" "}
                <strong className="text-foreground font-medium">
                  {modelStatus?.modelId || "Qwen2.5 7B (local)"}
                </strong>
              </span>
            </div>
          </div>
        )}
      </div>
        </>
      )}
      <div ref={bottomRef} />

      {/* Edit / New Sprint Metrics Modal */}
      {showEditSprintModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-background p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">
                {isNewSprint ? "Create New Sprint" : "Edit Sprint Metrics"}
              </h3>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setShowEditSprintModal(false)}
              >
                <X size={14} />
              </Button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-muted-foreground font-medium">Sprint Name</label>
                <input
                  type="text"
                  value={editSprintData.name || ""}
                  onChange={(e) =>
                    setEditSprintData({ ...editSprintData, name: e.target.value })
                  }
                  placeholder="e.g. Sprint 23 — Payments"
                  className="w-full h-8 px-2 mt-1 rounded border border-border bg-surface-1 text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-muted-foreground font-medium">Start Date</label>
                  <input
                    type="date"
                    value={editSprintData.start_date || ""}
                    onChange={(e) =>
                      setEditSprintData({ ...editSprintData, start_date: e.target.value })
                    }
                    className="w-full h-8 px-2 mt-1 rounded border border-border bg-surface-1 text-xs"
                  />
                </div>
                <div>
                  <label className="text-muted-foreground font-medium">End Date</label>
                  <input
                    type="date"
                    value={editSprintData.end_date || ""}
                    onChange={(e) =>
                      setEditSprintData({ ...editSprintData, end_date: e.target.value })
                    }
                    className="w-full h-8 px-2 mt-1 rounded border border-border bg-surface-1 text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-muted-foreground font-medium">Committed Points</label>
                  <input
                    type="number"
                    value={editSprintData.committed_points || 0}
                    onChange={(e) =>
                      setEditSprintData({ ...editSprintData, committed_points: Number(e.target.value) })
                    }
                    className="w-full h-8 px-2 mt-1 rounded border border-border bg-surface-1 text-xs"
                  />
                </div>
                <div>
                  <label className="text-muted-foreground font-medium">Completed Points</label>
                  <input
                    type="number"
                    value={editSprintData.completed_points || 0}
                    onChange={(e) =>
                      setEditSprintData({ ...editSprintData, completed_points: Number(e.target.value) })
                    }
                    className="w-full h-8 px-2 mt-1 rounded border border-border bg-surface-1 text-xs"
                  />
                </div>
                <div>
                  <label className="text-muted-foreground font-medium">Total Issues</label>
                  <input
                    type="number"
                    value={editSprintData.total_issues || 0}
                    onChange={(e) =>
                      setEditSprintData({ ...editSprintData, total_issues: Number(e.target.value) })
                    }
                    className="w-full h-8 px-2 mt-1 rounded border border-border bg-surface-1 text-xs"
                  />
                </div>
                <div>
                  <label className="text-muted-foreground font-medium">Completed Issues</label>
                  <input
                    type="number"
                    value={editSprintData.completed_issues || 0}
                    onChange={(e) =>
                      setEditSprintData({ ...editSprintData, completed_issues: Number(e.target.value) })
                    }
                    className="w-full h-8 px-2 mt-1 rounded border border-border bg-surface-1 text-xs"
                  />
                </div>
                <div>
                  <label className="text-muted-foreground font-medium">Blocked Issues</label>
                  <input
                    type="number"
                    value={editSprintData.blocked_issues || 0}
                    onChange={(e) =>
                      setEditSprintData({ ...editSprintData, blocked_issues: Number(e.target.value) })
                    }
                    className="w-full h-8 px-2 mt-1 rounded border border-border bg-surface-1 text-xs"
                  />
                </div>
                <div>
                  <label className="text-muted-foreground font-medium">Burndown Trend</label>
                  <select
                    value={editSprintData.burndown_trend || "on_track"}
                    onChange={(e) =>
                      setEditSprintData({ ...editSprintData, burndown_trend: e.target.value })
                    }
                    className="w-full h-8 px-2 mt-1 rounded border border-border bg-surface-1 text-xs"
                  >
                    <option value="on_track">on_track</option>
                    <option value="behind trend">behind trend</option>
                    <option value="ahead of trend">ahead of trend</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-muted-foreground font-medium">Blockers Description</label>
                <textarea
                  value={editSprintData.blockers || ""}
                  onChange={(e) => setEditSprintData({ ...editSprintData, blockers: e.target.value })}
                  rows={2}
                  placeholder="Describe any sprint blockers..."
                  className="w-full p-2 mt-1 rounded border border-border bg-surface-1 text-xs"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowEditSprintModal(false)}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={handleSaveSprintMetrics}>
                {isNewSprint ? "Create Sprint" : "Save Metrics"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

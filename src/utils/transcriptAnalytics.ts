export interface SpeakerStats {
  speaker: string;
  wordCount: number;
  turnCount: number;
  percentage: number; // 0-100
}

export interface SpeakerBalanceResult {
  score: number; // 0-100
  speakers: SpeakerStats[];
}

export function calculateSpeakerBalance(transcript: string | null | undefined): SpeakerBalanceResult | null {
  if (!transcript || !transcript.trim()) return null;

  const lines = transcript.split('\n');
  const counts: Record<string, { words: number; turns: number }> = {};

  for (const line of lines) {
    // Match "Speaker Name: message text" — supports multi-word names
    const match = line.match(/^([A-Za-z][A-Za-z\s'.]{0,30}):\s+(.+)$/);
    if (!match) continue;
    const name = match[1].trim();
    const words = match[2].split(/\s+/).filter(Boolean).length;
    if (words === 0) continue;
    if (!counts[name]) counts[name] = { words: 0, turns: 0 };
    counts[name].words += words;
    counts[name].turns += 1;
  }

  const speakerNames = Object.keys(counts);
  if (speakerNames.length === 0) return null; // No speaker tags detected

  const totalWords = Object.values(counts).reduce((acc, c) => acc + c.words, 0);
  if (totalWords === 0) return null;

  const speakers: SpeakerStats[] = speakerNames.map((name) => ({
    speaker: name,
    wordCount: counts[name].words,
    turnCount: counts[name].turns,
    percentage: Math.round((counts[name].words / totalWords) * 100),
  }));

  // Shannon entropy normalized to [0, 100]
  const n = speakers.length;
  if (n <= 1) return { score: 100, speakers };

  let entropy = 0;
  for (const s of speakers) {
    const p = s.wordCount / totalWords;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  const maxEntropy = Math.log2(n);
  const score = Math.round((entropy / maxEntropy) * 100);

  return { score, speakers };
}

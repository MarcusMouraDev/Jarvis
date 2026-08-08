export class InputAnalyzer {
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private data: Uint8Array<ArrayBuffer> | null = null;

  async start(): Promise<void> {
    if (this.analyser) return;

    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.context = new AudioContext();
    const source = this.context.createMediaStreamSource(this.stream);
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 256;
    source.connect(this.analyser);
    this.data = new Uint8Array(this.analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
  }

  readLevel(): number {
    if (!this.analyser || !this.data) return 0;
    this.analyser.getByteFrequencyData(this.data);
    let sum = 0;
    for (let i = 0; i < this.data.length; i += 1) sum += this.data[i];
    return Math.min(1, sum / this.data.length / 128);
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.context?.close();
    this.context = null;
    this.analyser = null;
    this.data = null;
  }
}

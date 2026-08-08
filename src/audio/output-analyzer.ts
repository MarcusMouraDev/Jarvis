export class OutputAnalyzer {
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private data: Uint8Array<ArrayBuffer> | null = null;
  private element: HTMLAudioElement | null = null;

  attach(audio: HTMLAudioElement): void {
    if (this.element === audio && this.analyser) return;
    this.detach();

    this.element = audio;
    this.context = new AudioContext();
    this.source = this.context.createMediaElementSource(audio);
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 256;
    this.source.connect(this.analyser);
    this.analyser.connect(this.context.destination);
    this.data = new Uint8Array(this.analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
  }

  readLevel(): number {
    if (!this.analyser || !this.data) return 0;
    this.analyser.getByteFrequencyData(this.data);
    let sum = 0;
    for (let i = 0; i < this.data.length; i += 1) sum += this.data[i];
    return Math.min(1, sum / this.data.length / 128);
  }

  detach(): void {
    this.source?.disconnect();
    void this.context?.close();
    this.source = null;
    this.context = null;
    this.analyser = null;
    this.data = null;
    this.element = null;
  }
}

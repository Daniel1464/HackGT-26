export type VoiceSession = { endSession: () => Promise<void> };
export type VoicePhase = 'disconnected' | 'connecting' | 'connected' | 'disconnecting';

/** One lifecycle per provider. Never reopen while the previous native audio is closing. */
export class VoiceSessionLifecycle {
  phase: VoicePhase = 'disconnected';
  private session?: VoiceSession;
  private finishing?: Promise<void>;
  private disposed = false;
  private lastError?: string;

  constructor(private readonly callbacks: {
    prepare: () => Promise<void>;
    release: () => Promise<void>;
    change: (phase: VoicePhase) => void;
    error: (message: string) => void;
    finished: (error?: string) => void;
  }) {}

  private change(phase: VoicePhase) {
    this.phase = phase;
    if (!this.disposed) this.callbacks.change(phase);
  }

  async start(startSession: () => void) {
    if (this.phase !== 'disconnected' || this.finishing || this.disposed) return;
    this.change('connecting');
    try {
      await this.callbacks.prepare();
      if (!this.disposed) startSession();
    } catch (error) {
      await this.fail(error);
    }
  }

  created(session: VoiceSession) {
    this.session = session;
    if (this.disposed || this.finishing) void session.endSession().catch(() => {});
  }

  connected() {
    if (!this.finishing && !this.disposed) this.change('connected');
  }

  fail(error: unknown) {
    this.report(error instanceof Error ? error.message : String(error));
    return this.finish();
  }

  private report(message: string) {
    this.lastError = message;
    if (!this.disposed) this.callbacks.error(message);
  }

  finish(): Promise<void> {
    if (this.finishing) return this.finishing;
    this.change('disconnecting');
    // Defer execution so synchronous/reentrant disconnect callbacks see the same promise.
    this.finishing = Promise.resolve().then(async () => {
      try {
        await this.session?.endSession();
      } catch (error) {
        this.report(`Could not close voice session: ${String(error)}`);
      }
      try {
        await this.callbacks.release();
      } catch (error) {
        this.report(`Could not reset microphone: ${String(error)}`);
      }
      if (!this.disposed) this.callbacks.finished(this.lastError);
    });
    return this.finishing;
  }

  dispose() {
    this.disposed = true;
    if (this.phase !== 'disconnected') void this.finish();
  }
}

import { vi } from "vitest";

/**
 * Faux micro pour les tests : un `getUserMedia` qui rend un flux dont on observe l'arrêt des pistes, et un `MediaRecorder`
 * qui produit un morceau d'audio à l'arrêt. Rien n'est enregistré pour de vrai.
 */
export interface FauxMicro {
  pistes: Array<{ stop: ReturnType<typeof vi.fn> }>;
  getUserMedia: ReturnType<typeof vi.fn>;
  enregistreurs: FauxEnregistreur[];
  restaurer: () => void;
}

export class FauxEnregistreur {
  static types = new Set(["audio/webm;codecs=opus", "audio/webm"]);
  static isTypeSupported = (type: string) => FauxEnregistreur.types.has(type);
  state: "inactive" | "recording" = "inactive";
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  flux: unknown;
  constructor(flux: unknown, options?: { mimeType?: string }) {
    this.flux = flux;
    this.mimeType = options?.mimeType ?? "audio/webm";
  }
  start() {
    this.state = "recording";
  }
  stop() {
    if (this.state === "inactive") return;
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3, 4])], { type: this.mimeType }) });
    this.onstop?.();
  }
}

export function installerFauxMicro(options: { refuser?: { name: string } } = {}): FauxMicro {
  const pistes = [{ stop: vi.fn() }];
  const enregistreurs: FauxEnregistreur[] = [];
  const getUserMedia = vi.fn(async () => {
    if (options.refuser) throw Object.assign(new Error("refus"), { name: options.refuser.name });
    return { getTracks: () => pistes } as unknown as MediaStream;
  });
  const ancienMedia = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
  const ancienRecorder = (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });

  class Suivi extends FauxEnregistreur {
    constructor(flux: unknown, opts?: { mimeType?: string }) {
      super(flux, opts);
      enregistreurs.push(this);
    }
  }
  Object.assign(Suivi, { isTypeSupported: FauxEnregistreur.isTypeSupported });
  (globalThis as { MediaRecorder?: unknown }).MediaRecorder = Suivi;

  const urls = vi.fn(() => "blob:apercu-vocal");
  const ancienCreate = URL.createObjectURL;
  const ancienRevoke = URL.revokeObjectURL;
  URL.createObjectURL = urls as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn();

  return {
    pistes,
    getUserMedia,
    enregistreurs,
    restaurer() {
      if (ancienMedia) Object.defineProperty(navigator, "mediaDevices", ancienMedia);
      else delete (navigator as unknown as { mediaDevices?: unknown }).mediaDevices;
      (globalThis as { MediaRecorder?: unknown }).MediaRecorder = ancienRecorder;
      URL.createObjectURL = ancienCreate;
      URL.revokeObjectURL = ancienRevoke;
    },
  };
}

import { isSameOrigin } from "./workspace.js";

type DisplayMediaRequest = {
  securityOrigin: string;
  videoRequested: boolean;
};

type DisplaySource = {
  id: string;
  name: string;
  thumbnail: {
    toDataURL(): string;
  };
};

export type DisplaySourceChoice = {
  index: number;
  name: string;
  thumbnail: string;
  type: "screen" | "window";
};

export function canAccessWorkspace(requestingUrl: string, workspaceUrl: string | null): boolean {
  return Boolean(workspaceUrl && isSameOrigin(requestingUrl, workspaceUrl));
}

export function canShareDisplay(request: DisplayMediaRequest, workspaceUrl: string | null): boolean {
  return request.videoRequested && canAccessWorkspace(request.securityOrigin, workspaceUrl);
}

export function serializeDisplaySources(sources: DisplaySource[]): DisplaySourceChoice[] {
  return sources.map((source, index) => ({
    index,
    name: source.name,
    thumbnail: source.thumbnail.toDataURL(),
    type: source.id.startsWith("screen:") ? "screen" : "window"
  }));
}

export function selectDisplaySource<T>(sources: T[], index: unknown): T | undefined {
  return Number.isInteger(index) && Number(index) >= 0 ? sources[Number(index)] : undefined;
}

export function displayMediaHandlerOptions(platform: NodeJS.Platform): { useSystemPicker: true } | undefined {
  return platform === "darwin" ? { useSystemPicker: true } : undefined;
}

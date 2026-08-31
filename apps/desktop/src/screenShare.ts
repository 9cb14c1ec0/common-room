import { isSameOrigin } from "./workspace.js";

type DisplayMediaRequest = {
  securityOrigin: string;
  videoRequested: boolean;
};

type DisplaySource = {
  display_id: string;
};

export function canAccessWorkspace(requestingUrl: string, workspaceUrl: string | null): boolean {
  return Boolean(workspaceUrl && isSameOrigin(requestingUrl, workspaceUrl));
}

export function canShareDisplay(request: DisplayMediaRequest, workspaceUrl: string | null): boolean {
  return request.videoRequested && canAccessWorkspace(request.securityOrigin, workspaceUrl);
}

export function selectDisplaySource<T extends DisplaySource>(sources: T[], primaryDisplayId: number): T | undefined {
  return sources.find((source) => source.display_id === String(primaryDisplayId)) ?? sources[0];
}

export function displayMediaHandlerOptions(platform: NodeJS.Platform): { useSystemPicker: true } | undefined {
  return platform === "darwin" ? { useSystemPicker: true } : undefined;
}

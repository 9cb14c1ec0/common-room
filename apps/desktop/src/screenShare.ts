import { isSameOrigin } from "./workspace.js";

type DisplayMediaRequest = {
  securityOrigin: string;
  videoRequested: boolean;
};

type DisplaySource = {
  display_id: string;
};

export function canShareDisplay(request: DisplayMediaRequest, workspaceUrl: string | null): boolean {
  return Boolean(
    workspaceUrl
      && request.videoRequested
      && isSameOrigin(request.securityOrigin, workspaceUrl)
  );
}

export function selectDisplaySource<T extends DisplaySource>(sources: T[], primaryDisplayId: number): T | undefined {
  return sources.find((source) => source.display_id === String(primaryDisplayId)) ?? sources[0];
}

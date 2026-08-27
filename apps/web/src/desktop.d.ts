export {};

declare global {
  interface Window {
    commonRoomDesktop?: {
      showNotification(title: string, body: string): Promise<boolean>;
    };
  }
}

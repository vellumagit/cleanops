declare module "web-push" {
  interface PushSubscription {
    endpoint: string;
    keys: {
      p256dh: string;
      auth: string;
    };
  }

  interface SendResult {
    statusCode: number;
    headers: Record<string, string>;
    body: string;
  }

  interface RequestOptions {
    TTL?: number;
    headers?: Record<string, string>;
    vapidDetails?: {
      subject: string;
      publicKey: string;
      privateKey: string;
    };
  }

  interface VapidKeys {
    publicKey: string;
    privateKey: string;
  }

  function setVapidDetails(
    subject: string,
    publicKey: string,
    privateKey: string,
  ): void;

  function sendNotification(
    subscription: PushSubscription,
    payload: string | Buffer | null,
    options?: RequestOptions,
  ): Promise<SendResult>;

  function generateVAPIDKeys(): VapidKeys;

  export default {
    setVapidDetails,
    sendNotification,
    generateVAPIDKeys,
  };
}

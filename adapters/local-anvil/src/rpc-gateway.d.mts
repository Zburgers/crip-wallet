export interface AnvilRpcGatewayOptions {
  upstreamUrl: string;
  lockPath: string;
  snapshotPath: string;
  poisonPath: string;
  host?: string;
  port?: number;
}

export interface AnvilRpcGateway {
  url: string;
  close(): Promise<void>;
}

export declare const startAnvilRpcGateway: (
  options: AnvilRpcGatewayOptions,
) => Promise<AnvilRpcGateway>;

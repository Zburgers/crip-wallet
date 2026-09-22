export declare const withChainMutationLease: <T>(
  lockPath: string,
  work: () => Promise<T>,
) => Promise<T>;

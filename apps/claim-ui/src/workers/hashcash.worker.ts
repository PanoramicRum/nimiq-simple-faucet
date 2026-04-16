import { solveHashcash } from '@nimiq-faucet/sdk';

interface SolveMessage {
  challenge: string;
  difficulty: number;
}

self.onmessage = async (e: MessageEvent<SolveMessage>) => {
  const { challenge, difficulty } = e.data;
  try {
    const nonce = await solveHashcash(challenge, difficulty, (attempts) => {
      (self as unknown as Worker).postMessage({ type: 'progress', attempts });
    });
    (self as unknown as Worker).postMessage({ type: 'done', nonce });
  } catch (err) {
    (self as unknown as Worker).postMessage({
      type: 'error',
      message: (err as Error).message,
    });
  }
};

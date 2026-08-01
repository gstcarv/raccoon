/* eslint-disable @typescript-eslint/no-namespace */
declare global {
  namespace Express {
    interface Request {
      id: string;
      rawBody?: Buffer;
    }
  }
}
/* eslint-enable @typescript-eslint/no-namespace */

export {};

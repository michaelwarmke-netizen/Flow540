export class Logger {
  private readonly context: string;

  constructor(context: string = 'App') {
    this.context = context;
  }

  debug(message: string, ...optionalParams: unknown[]): void {
    console.debug(`[${this.context}]`, message, ...optionalParams);
  }

  info(message: string, ...optionalParams: unknown[]): void {
    console.info(`[${this.context}]`, message, ...optionalParams);
  }

  warn(message: string, ...optionalParams: unknown[]): void {
    console.warn(`[${this.context}]`, message, ...optionalParams);
  }

  error(message: string, ...optionalParams: unknown[]): void {
    console.error(`[${this.context}]`, message, ...optionalParams);
  }

  log(message: string, ...optionalParams: unknown[]): void {
    console.log(`[${this.context}]`, message, ...optionalParams);
  }
}

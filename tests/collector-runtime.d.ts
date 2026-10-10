declare const Deno: {
  env: { get(name: string): string | undefined };
  resolveDns(host: string, type: "A"): Promise<string[]>;
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

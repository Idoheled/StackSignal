import { env } from 'cloudflare:workers';
import { createService, type Config } from '@/lib/server/service';
export const dynamic = 'force-dynamic';
function handle(request:Request){return createService(env as unknown as Config)(request);}
export const GET=handle;
export const POST=handle;
export const PUT=handle;
export const DELETE=handle;

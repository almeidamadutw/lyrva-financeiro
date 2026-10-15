/** Retry-After can be seconds or an HTTP date. Never retry before the requested time. */
export function retryAfterSeconds(value, now=Date.now()) {
  if(value==null || !String(value).trim())return null;
  const text=String(value).trim();
  if(/^\d+$/.test(text))return Math.min(604800,Number(text));
  const date=Date.parse(text);
  return Number.isFinite(date)?Math.min(604800,Math.max(0,Math.ceil((date-now)/1000))):null;
}

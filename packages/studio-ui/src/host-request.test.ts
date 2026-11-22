import { afterEach, expect, it, vi } from 'vitest';
import { editorRequest } from './host-request';
import { setStudioProviders, unavailableProviders } from '@pireel/studio-engine/providers';
afterEach(() => {setStudioProviders(unavailableProviders());vi.unstubAllGlobals();});
it('keeps AI/account requests off the network until a host is connected', async () => {
 const network=vi.fn();vi.stubGlobal('fetch',network);setStudioProviders(unavailableProviders());
 await expect(editorRequest('/api/studio/chat')).rejects.toThrow('not configured');
 expect(network).not.toHaveBeenCalled();
});
it('passes service requests to the configured host transport', async () => {
 const request=vi.fn(async()=>Response.json({ok:true}));setStudioProviders({...unavailableProviders(),request});
 await editorRequest('/api/studio/chat',{method:'POST',body:'{}'});
 expect(request).toHaveBeenCalledWith('/api/studio/chat',{method:'POST',body:'{}'});
});
it('does not forward external media through an authenticated host transport', async () => {
 const request=vi.fn();const network=vi.fn(async()=>new Response('media'));vi.stubGlobal('fetch',network);setStudioProviders({...unavailableProviders(),request});
 await editorRequest('https://assets.example/video.mp4');
 expect(request).not.toHaveBeenCalled();expect(network).toHaveBeenCalled();
});

it('allows chat requests with absolute same-origin URL when chatEndpoint is configured', async () => {
 const network=vi.fn(async()=>Response.json({ok:true}));vi.stubGlobal('fetch',network);vi.stubGlobal('location',{origin:'http://localhost:5173'});setStudioProviders({...unavailableProviders(),chatEndpoint:'/api/studio/chat'});
 await editorRequest('http://localhost:5173/api/studio/chat',{method:'POST',body:'{}'});
 expect(network).toHaveBeenCalledWith('http://localhost:5173/api/studio/chat',{method:'POST',body:'{}'});
});

it('allows chat requests to use fetch when chatEndpoint is configured but no host request', async () => {
 const network=vi.fn(async()=>Response.json({ok:true}));vi.stubGlobal('fetch',network);setStudioProviders({...unavailableProviders(),chatEndpoint:'/api/studio/chat'});
 await editorRequest('/api/studio/chat',{method:'POST',body:'{}'});
 expect(network).toHaveBeenCalledWith('/api/studio/chat',{method:'POST',body:'{}'});
});

it('allows chat requests with query string when chatEndpoint is configured', async () => {
 const network=vi.fn(async()=>Response.json({ok:true}));vi.stubGlobal('fetch',network);vi.stubGlobal('location',{origin:'http://localhost:5173'});setStudioProviders({...unavailableProviders(),chatEndpoint:'/api/studio/chat'});
 await editorRequest('/api/studio/chat?session=xyz',{method:'POST',body:'{}'});
 expect(network).toHaveBeenCalledWith('/api/studio/chat?session=xyz',{method:'POST',body:'{}'});
});

it('rejects non-chat API requests when no host request configured', async () => {
 const network=vi.fn();vi.stubGlobal('fetch',network);setStudioProviders({...unavailableProviders(),chatEndpoint:'/api/studio/chat'});
 await expect(editorRequest('/api/other/endpoint')).rejects.toThrow('not configured');
 expect(network).not.toHaveBeenCalled();
});

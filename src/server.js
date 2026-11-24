import express from 'express';
import { fileURLToPath } from 'node:url';
import { createPlan, revisePlan } from './plan.js';
import { listPlaces } from './search-places.js';
import { recommendLodging } from './lodging.js';
import { planSessionsReady } from './plan-snapshots.js';

const app = express();
const publicDirectory = fileURLToPath(new URL('../public/', import.meta.url));
app.disable('x-powered-by');
app.use('/api', (_request, response, next) => {
  response.set('Cache-Control', 'no-store');
  next();
});
app.get('/api/health', (_request, response) => {
  const ready = planSessionsReady();
  response.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'configuration_required', mode: 'ai' });
});
app.use('/api/plan', (_request, response, next) => {
  if (!planSessionsReady()) return response.status(503).json({ error: '서버의 일정 세션 설정을 확인해 주세요.' });
  return next();
});
app.post('/api/plan', express.json({ limit: '8kb' }), createPlan);
app.post('/api/plan/revise', express.json({ limit: '1mb' }), revisePlan);
app.post('/api/plan/lodging', express.json({ limit: '1mb' }), recommendLodging);
app.get('/api/places', listPlaces);
app.get('/api/map-config', (_request, response) => {
  response.json({ clientId: process.env.NAVER_MAPS_WEB_CLIENT_ID?.trim() || process.env.NAVER_MAPS_CLIENT_ID?.trim() || '' });
});
app.use('/api/plan', (error, _request, response, next) => {
  if (error.status === 413) return response.status(413).json({ error: '여행 조건이 너무 깁니다.' });
  if (error.status === 400) return response.status(400).json({ error: '요청 형식이 올바르지 않습니다.' });
  return next(error);
});
app.use('/api', (_request, response) => response.status(404).json({ error: '요청한 API를 찾을 수 없습니다.' }));
app.use(express.static(publicDirectory, { dotfiles: 'deny' }));
app.use((error, _request, response, next) => {
  if (response.headersSent) return next(error);
  console.error('Request failed:', error.name);
  return response.status(500).json({ error: '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' });
});

export default app;

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.');
  app.listen(port, '127.0.0.1', () => {
    console.log(`여행 플래너: http://127.0.0.1:${port}`);
  });
}

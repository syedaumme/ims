import axios from 'axios';

const API = axios.create({
  baseURL: process.env.REACT_APP_API_URL || '/api',
  timeout: 10000,
});

export const fetchWorkItems = (params = {}) =>
  API.get('/work-items', { params }).then((r) => r.data);

export const fetchWorkItem = (id) =>
  API.get(`/work-items/${id}`).then((r) => r.data);

export const fetchSignals = (workItemId) =>
  API.get('/signals', { params: { workItemId } }).then((r) => r.data);

export const updateStatus = (id, status) =>
  API.patch(`/work-items/${id}/status`, { status }).then((r) => r.data);

export const submitRca = (id, rca) =>
  API.post(`/work-items/${id}/rca`, rca).then((r) => r.data);

export const fetchHealth = () =>
  API.get('/health', { baseURL: '' }).then((r) => r.data);

export const ingestSignal = (signal) =>
  API.post('/signals', signal).then((r) => r.data);

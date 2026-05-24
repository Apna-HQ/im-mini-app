import type { Metadata } from 'next';
import App from '../src/App';

export const metadata: Metadata = {
  title: 'Apna IM',
  description: 'Apna mini-app for WebRTC voice and video calls.',
};

export default function Page() {
  return <App />;
}

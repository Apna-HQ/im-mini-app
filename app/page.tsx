import App from '../src/App';
import { ApnaProvider } from '../src/apna-provider';

export default function Page() {
  return (
    <ApnaProvider appId="im-mini-app">
      <App />
    </ApnaProvider>
  );
}

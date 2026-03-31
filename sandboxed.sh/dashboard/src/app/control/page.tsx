import { Suspense } from 'react';
import { Loader } from 'lucide-react';
import ControlClient from './control-client';

export default function ControlPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[calc(100vh-4rem)]">
          <Loader className="h-8 w-8 animate-spin text-white/40" />
        </div>
      }
    >
      <ControlClient />
    </Suspense>
  );
}


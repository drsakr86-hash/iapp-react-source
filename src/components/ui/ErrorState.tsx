import { Button } from './Button';

/** A failed load, with a way out: the message plus a retry button. */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="errorstate" role="alert">
      <div className="errorstate__icon" aria-hidden="true">
        ⚠️
      </div>
      <p className="errorstate__msg">{message}</p>
      {onRetry ? (
        <Button variant="outline" onClick={onRetry}>
          إعادة المحاولة
        </Button>
      ) : null}
    </div>
  );
}

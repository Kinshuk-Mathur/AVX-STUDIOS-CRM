import { initializeWorkspace } from '../src/server/firebase/bootstrap';
import { closeFirebase } from '../src/server/firebase/client';
initializeWorkspace()
  .then((result) =>
    console.log(
      result.initialized
        ? 'Firestore workspace initialized.'
        : 'Firestore workspace is already initialized.',
    ),
  )
  .catch(() => {
    console.error(
      'Firestore initialization failed. Check the private server credentials and database access.',
    );
    process.exitCode = 1;
  })
  .finally(closeFirebase);

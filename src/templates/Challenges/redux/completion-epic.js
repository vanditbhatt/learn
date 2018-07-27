import { of } from 'rxjs/observable/of';
import { empty } from 'rxjs/observable/empty';
import { switchMap, retry, catchError, concat, filter } from 'rxjs/operators';
import { ofType } from 'redux-observable';
import { push } from 'react-router-redux';

import {
  backendFormValuesSelector,
  projectFormVaulesSelector,
  submitComplete,
  types,
  challengeMetaSelector,
  challengeTestsSelector,
  closeModal,
  challengeFilesSelector
} from './';
import {
  userSelector,
  isSignedInSelector,
  openDonationModal,
  shouldShowDonationSelector,
  updateComplete,
  updateFailed
} from '../../../redux/app';

import postUpdate$ from '../utils/postUpdate$';
import { challengeTypes, submitTypes } from '../../../../utils/challengeTypes';

function postChallenge(update, username) {
  const saveChallenge = postUpdate$(update).pipe(
    retry(3),
    switchMap(({ points }) =>
      of(
        submitComplete({
          username,
          points,
          ...update.payload
        }),
        updateComplete()
      )
    ),
    catchError(() => of(updateFailed(update)))
  );
  return saveChallenge;
}

function submitModern(type, state) {
  const tests = challengeTestsSelector(state);
  if (tests.length > 0 && tests.every(test => test.pass && !test.err)) {
    if (type === types.checkChallenge) {
      return of({ type: 'this was a check challenge' });
    }

    if (type === types.submitChallenge) {
      const { id } = challengeMetaSelector(state);
      const files = challengeFilesSelector(state);
      const { username } = userSelector(state);
      const challengeInfo = {
        id,
        files
      };
      const update = {
        endpoint: '/external/modern-challenge-completed',
        payload: challengeInfo
      };
      return postChallenge(update, username);
    }
  }
  return empty();
}

function submitProject(type, state) {
  if (type === types.checkChallenge) {
    return empty();
  }

  const { solution, githubLink } = projectFormVaulesSelector(state);
  const { id, challengeType } = challengeMetaSelector(state);
  const { username } = userSelector(state);
  const challengeInfo = { id, challengeType, solution };
  if (challengeType === challengeTypes.backEndProject) {
    challengeInfo.githubLink = githubLink;
  }

  const update = {
    endpoint: '/external/project-completed',
    payload: challengeInfo
  };
  return postChallenge(update, username);
}

function submitBackendChallenge(type, state) {
  const tests = challengeTestsSelector(state);
  if (tests.length > 0 && tests.every(test => test.pass && !test.err)) {
    if (type === types.submitChallenge) {
      const { id } = challengeMetaSelector(state);
      const { username } = userSelector(state);
      const { solution: { value: solution } } = backendFormValuesSelector(
        state
      );
      const challengeInfo = { id, solution };

      const update = {
        endpoint: '/external/backend-challenge-completed',
        payload: challengeInfo
      };
      return postChallenge(update, username);
    }
  }
  return empty();
}

const submitters = {
  tests: submitModern,
  backend: submitBackendChallenge,
  'project.frontEnd': submitProject,
  'project.backEnd': submitProject
};

function shouldShowDonate(state) {
  return shouldShowDonationSelector(state) ? of(openDonationModal()) : empty();
}

export default function completionEpic(action$, { getState }) {
  return action$.pipe(
    ofType(types.submitChallenge),
    switchMap(({ type }) => {
      const state = getState();
      const meta = challengeMetaSelector(state);
      const { isDonating } = userSelector(state);
      const { nextChallengePath, introPath, challengeType } = meta;
      const next = of(push(introPath ? introPath : nextChallengePath));
      const showDonate = isDonating ? empty() : shouldShowDonate(state);
      const closeChallengeModal = of(closeModal('completion'));
      let submitter = () => of({ type: 'no-user-signed-in' });
      if (
        !(challengeType in submitTypes) ||
        !(submitTypes[challengeType] in submitters)
      ) {
        throw new Error(
          'Unable to find the correct submit function for challengeType ' +
            challengeType
        );
      }
      if (isSignedInSelector(state)) {
        submitter = submitters[submitTypes[challengeType]];
      }

      return submitter(type, state).pipe(
        concat(next),
        concat(closeChallengeModal),
        concat(showDonate),
        filter(Boolean)
      );
    })
  );
}

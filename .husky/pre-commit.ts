#!/usr/bin/env node
import {
  DependencyChecks,
  DockerfileInstallsFromLockfile,
  Format,
  LockfileSync,
  NoNumericPins,
  NpmrcPolicy,
  preCommit,
} from '@zukhruf/git-hooks';

await preCommit([
  new Format(),
  new NoNumericPins(),
  new NpmrcPolicy(),
  new LockfileSync(),
  new DockerfileInstallsFromLockfile(),
  new DependencyChecks(),
]);

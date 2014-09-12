#!/bin/bash

NODE=`which node`
FILES=test/test-*.js
EXITCODE=0

for test in $FILES
do
  trap "echo Exited!; exit;" SIGINT SIGTERM
  echo -n "$test: "
  if $NODE $test > /dev/null; then
    echo "PASS" 
  else
    echo "FAIL"
    EXITCODE=1
  fi
done

# Exit with error if any tests didn't pass.
exit $EXITCODE
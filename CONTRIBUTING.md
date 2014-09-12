
Thank you for your interest in contributing to this project!

## New Issues

If you are opening an issue, please include:

- a detailed description of the problem
- a description of the expected outcome
- detailed steps to reproduce the issue
- the version of node.js, this module, and RabbitMQ

## Pull Requests

If you are opening a pull request (*thanks!*), please include:

- a detailed description of the fix/improvement
- test(s) that prove the code works
- documentation updates _if necessary_

All tests must pass before the PR will be accepted.

## Running the tests

The test suite expects a rabbit server running on the local machine.

To run the test suite:

    make test

If you'd like to run a specific test alone:

    node test/test-simple.js

If you'd like to use a server other than `localhost:5762`:

    make test SERVER=otherserver:port

or

    node test/test-simple.js otherserver:port

The `NODE_DEBUG_AMQP=1` environment variable can also be useful for debugging.


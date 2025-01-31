# Contributing

We welcome contributions to this project! To ensure a smooth collaboration, please follow these guidelines when
contributing.

## Steps to Contribute

1. **Clone the Repository**
    - Clone the repository to your local machine using:
      ```sh
      git clone <repository-url>
      ```

2. **Create a New Branch**
    - Always create a new branch for your changes:
      ```sh
      git checkout -b feature/my-awesome-feature
      ```

3. **Install Dependencies**
    - Run `yarn install` to install all required dependencies.

4. **Make Your Changes**
    - Add the feature, bug fix, or improvement you are working on.
    - Ensure that your code passes the linter checks (see the `lint` script in the `package.json`).

5. **Run Lint and Tests**
    - Run the lint checks to ensure your code follows the project's style guide:
      ```sh
      yarn lint
      ```
    - Run the automatic code style fixing
      ```sh
      yarn fix
      ```      
    - Run the tests to ensure your changes don’t break anything:
      ```sh
      yarn test
      ```

6. **Create a Pull Request**
    - Push your changes to your branch:
      ```sh
      git push origin feature/my-awesome-feature
      ```
    - Create a pull request (PR) from your branch to the `develop` branch. **Never push directly to the master branch**.

7. **Follow the PR Template**
    - Please ensure your pull request includes a clear title, description, and any relevant information about the
      changes.

8. **Code Review**
    - A project maintainer will review your pull request. If necessary, make any requested changes and push them to your
      branch.

## Important Notes

- **Never push directly to the master branch**. Always create a separate branch for each feature or bug fix.
- Ensure your code passes all lint checks before submitting a pull request.
- Ensure your code matches the architecture and patterns of the project
- Add unit tests for new features or bug fixes.
- Follow the project's code style and formatting guidelines to ensure consistency.

## License

By contributing to this project, you agree that your contributions will be licensed under the same terms as the project.

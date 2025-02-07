# Node Js GitHub Public Repos Cloner

This application clones all repositories and their branches for a given GitHub user.

## Setup

1. Clone the repository:
    ```sh
    git clone https://github.com/zeeshanalimughal/node-github-repositories-cloner.git
    ```
    
2.  Go to the project directory:
    ```sh
    cd node-github-repositories-cloner
    ```
3. Install the dependencies:
    ```sh
    npm install
    ```

4. Create a `.env` file by copying the example file:
    ```sh
    cp .env.example .env
    ```

5. Add your GitHub access token to the .env file:
    ```
    GITHUB_ACCESS_TOKEN=your_github_access_token_here
    ```

## How to Run

Run the application with the GitHub username as an argument:
For example:

```sh
node index.js zeeshanalimughal
```

This will clone all repositories and their branches for the specified GitHub user into the repositories directory.
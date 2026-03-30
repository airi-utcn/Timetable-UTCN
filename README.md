# UTCN Timetable Viewer

A modern Flask + React application for viewing and managing university timetables. This project imports events from Outlook "published calendar" URLs (both ICS and HTML), normalizes subject and location data, and provides a modern single-page application (SPA) interface with schedule, departures board, and admin functionality.

Built for the **Technical University of Cluj-Napoca (UTCN)**, Faculty of Automation and Computer Science.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Development Environment Setup](#development-environment-setup)
  - [Prerequisites](#prerequisites)
  - [Configuration](#configuration)
- [Running the Application](#running-the-application)
- [Testing](#testing)
  - [Automated Local Admin Test](#automated-local-admin-test)
  - [Manual Testing](#manual-testing)
- [How to Contribute](#how-to-contribute)
  - [Reporting Bugs and Suggesting Features](#reporting-bugs-and-suggesting-features)
  - [Contribution Workflow](#contribution-workflow)
  - [Areas for Contribution](#areas-for-contribution)
- [License](#license)

## Overview

The system ingests room calendars published by Outlook/Exchange for ~200 rooms, parses ICS feeds or scrapes HTML calendar pages with Playwright, and exposes the merged timetable through a React SPA. The UI provides multiple views for easy consumption of schedule data.

## Features

- **Dual-URL Pipeline**: Fast, concurrent ICS feed parsing with a robust HTML/Playwright scraping fallback.
- **Data Normalization**: Cleans and standardizes subject names, groups, and room details.
- **Modern Frontend**: A responsive React SPA built with Vite, offering:
  - **Schedule View**: A classic weekly timetable grid, filterable by room, subject, or professor.
  - **Departures View**: A "departures board" style display for today's and tomorrow's events.
  - **Admin Panel**: Manage calendar sources, trigger manual data imports, and add extracurricular events.
- **Automated Deployment**: A single `deploy.sh` script for setting up and running the entire stack via Docker.
- **Extensible**: Easily add new calendar sources or custom event parsers.

## Tech Stack

- **Backend**: Flask (Python)
- **Frontend**: React (JavaScript/Vite)
- **Data Storage**: SQLite for calendar metadata and extracurricular events. Event data is stored as JSON files.
- **Web Scraping**: Playwright
- **Containerization**: Docker and Docker Compose

## Project Structure

```
.
├── app.py                # Main Flask application: API routes, background tasks
├── deploy.sh             # One-command deployment script for local/VM setup
├── docker-compose.yml    # Defines the services, networks, and volumes for Docker
├── Dockerfile            # Instructions to build the main application's Docker image
├── requirements.txt      # Python backend dependencies
├── frontend/             # React SPA source code
│   ├── src/              # Main application source
│   ├── package.json      # Frontend dependencies (npm)
│   └── vite.config.js    # Vite configuration
├── tools/                # Helper and automation scripts (e.g., data extraction)
├── static/               # Static assets served by Flask
├── templates/            # HTML templates for Flask (e.g., admin login)
├── config/               # Configuration files for room/building aliases
└── data/                 # SQLite database files
```

## Development Environment Setup

### Prerequisites

To develop and run this application, you need the following tools installed on your system:

- **Git**: For version control.
- **Docker**: To run the application in containers.
- **Docker Compose**: To orchestrate the multi-container application.
- A text editor or IDE (e.g., VS Code).

### Configuration

The application is configured using a `.env` file in the project root.

1.  **Create the `.env` file**:
    If you don't have a `.env` file, you can copy the example file:
    ```bash
    cp .env.example .env
    ```

2.  **Edit `.env`**:
    Open the `.env` file and configure the variables. The most important ones are:
    - `ADMIN_USERNAME`: The username for the admin panel.
    - `ADMIN_PASSWORD`: The password for the admin panel. **Change the default value for security.**
    - `FLASK_SECRET`: A secret key for signing sessions. The `deploy.sh` script will generate one automatically if it's missing.
    - `PLAYWRIGHT_USERNAME` / `PLAYWRIGHT_PASSWORD`: Credentials for accessing the Outlook calendars if they are protected.

## Running the Application

The easiest way to run the entire application stack is using the provided deployment script. This script handles everything from pulling the latest code to building Docker images and starting the services.

```bash
./deploy.sh
```

This command will:
1.  Stop any existing containers.
2.  Build the Docker images for the application and its services.
3.  Start all services in detached mode.
4.  Wait for the application to become healthy.
5.  Run an automated test to verify that the local admin login is working.

Once the script finishes, you can access the application at `http://localhost:5000`. The admin panel is available at `http://localhost:5000/admin`.

## Testing

### Automated Local Admin Test

The `deploy.sh` script automatically runs a test to verify that the admin credentials from your `.env` file are correctly passed to the application and that the login process works. This test performs the following steps:
1.  Sends a GET request to `/admin` to retrieve a CSRF token and session cookie.
2.  Sends a POST request to `/admin/login` with the credentials and the CSRF token.
3.  Checks the response to ensure the login was successful.

If the test fails, it will print an error message, which usually indicates a problem with how environment variables are being passed to the Docker container.

### Manual Testing

1.  **Frontend**: Navigate to `http://localhost:5000` and interact with the Schedule and Departures views. Use the filters to check if the data is displayed correctly.
2.  **Admin Panel**: Go to `http://localhost:5000/admin` and log in with your admin credentials.
    - Try adding or removing a calendar source.
    - Trigger a manual data import.
    - Add an extracurricular event and verify it appears in the schedule.
3.  **Data Parsing**: Check the `playwright_captures/` directory for the JSON files containing event data. Inspect these files to ensure the data has been parsed correctly from the ICS/HTML sources.

## How to Contribute

We welcome contributions from the community! Whether you're fixing a bug, improving a feature, or suggesting a new idea, your help is valuable.

### Reporting Bugs and Suggesting Features

Please use the [GitHub Issues](https://github.com/stefi19/GenerateTimetableFromOutlookCalendar/issues) page to report bugs or propose new features. Provide as much detail as possible, including:
- A clear and descriptive title.
- Steps to reproduce the bug.
- Expected behavior and actual behavior.
- Screenshots or logs, if applicable.

### Contribution Workflow

1.  **Fork the repository**: Create your own copy of the project.
2.  **Create a new branch**:
    ```bash
    git checkout -b feature/your-feature-name
    ```
3.  **Make your changes**: Implement your feature or bug fix.
4.  **Commit your changes**: Write a clear and concise commit message.
    ```bash
    git commit -m "feat: Add new feature"
    ```
5.  **Push to your branch**:
    ```bash
    git push origin feature/your-feature-name
    ```
6.  **Create a Pull Request**: Open a pull request from your forked repository to the main project. Provide a detailed description of your changes.

### Areas for Contribution

- **Improve Data Parsers**: The logic for parsing event titles in `tools/subject_parser.py` can always be improved to handle more edge cases and variations in event naming.
- **Enhance the Frontend**: Add new features to the React UI, improve performance, or enhance the user experience.
- **Add More Tests**: Increase test coverage for both the backend and frontend to ensure stability.
- **Improve Documentation**: Help us keep this `README` and other documentation clear and up-to-date.

## License

This project is licensed under the [MIT License](LICENSE).

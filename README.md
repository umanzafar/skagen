# Skagen Attendance & Task Tracker

React frontend backed by **Supabase** (Postgres + Storage). Previously used Google Sheets + Apps Script — that backend has been fully removed.

## Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** in your project and run the contents of [`supabase/schema.sql`](./supabase/schema.sql). This creates the `employees`, `daily_logs`, `tasks`, `manager_config` tables, RLS policies, the `employee-photos` storage bucket, and seeds the 5 employees + manager password from the requirements doc.
3. Go to **Project Settings > API** and copy the **Project URL** and **anon public** key.
4. Copy `.env.example` to `.env` and fill in:
   ```
   REACT_APP_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
   REACT_APP_SUPABASE_ANON_KEY=YOUR-ANON-PUBLIC-KEY
   ```
5. `npm install` then `npm run build` to verify everything compiles. (Deploy the `build` folder, or run `npm start` locally when you're ready to test in a browser — not run automatically here per request.)

### Security note

Per current design, employee/manager passwords are stored in plain text in the `employees` / `manager_config` tables (matching the original Apps Script version's behavior), and Row Level Security policies allow the `anon` key full read/write — same trust model as the old "Anyone can access" Apps Script deployment. This is fine for a small internal team tool, but if this ever needs to be internet-facing beyond trusted staff, swap to Supabase Auth + hashed passwords + per-user RLS policies.

---

# Getting Started with Create React App

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

The page will reload when you make changes.\
You may also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can't go back!**

If you aren't satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you're on your own.

You don't have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn't feel obligated to use this feature. However we understand that this tool wouldn't be useful if you couldn't customize it when you are ready for it.

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).

### Code Splitting

This section has moved here: [https://facebook.github.io/create-react-app/docs/code-splitting](https://facebook.github.io/create-react-app/docs/code-splitting)

### Analyzing the Bundle Size

This section has moved here: [https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size](https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size)

### Making a Progressive Web App

This section has moved here: [https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app](https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app)

### Advanced Configuration

This section has moved here: [https://facebook.github.io/create-react-app/docs/advanced-configuration](https://facebook.github.io/create-react-app/docs/advanced-configuration)

### Deployment

This section has moved here: [https://facebook.github.io/create-react-app/docs/deployment](https://facebook.github.io/create-react-app/docs/deployment)

### `npm run build` fails to minify

This section has moved here: [https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify](https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify)

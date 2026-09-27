import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('hjen', {
    // API keys
    getApiKey: () => ipcRenderer.invoke('hjen:get-api-key'),
    setApiKey: (key) => ipcRenderer.invoke('hjen:set-api-key', key),
    getGoogleKey: () => ipcRenderer.invoke('hjen:get-google-key'),
    setGoogleKey: (key) => ipcRenderer.invoke('hjen:set-google-key', key),
    getAnthropicKey: () => ipcRenderer.invoke('hjen:get-anthropic-key'),
    setAnthropicKey: (key) => ipcRenderer.invoke('hjen:set-anthropic-key', key),
    // Claude-powered prompt enhancement (vision)
    enhancePrompt: (args) => ipcRenderer.invoke('hjen:enhance-prompt', args),
    listEnhancements: () => ipcRenderer.invoke('hjen:list-enhancements'),
    // Pending-job crash-recovery
    savePendingJob: (args) => ipcRenderer.invoke('hjen:save-pending-job', args),
    clearPendingJob: (args) => ipcRenderer.invoke('hjen:clear-pending-job', args),
    listPendingJobs: () => ipcRenderer.invoke('hjen:list-pending-jobs'),
    // Failed-job debug history (API rejections, network errors, etc.)
    saveFailedJob: (args) => ipcRenderer.invoke('hjen:save-failed-job', args),
    listFailedJobs: () => ipcRenderer.invoke('hjen:list-failed-jobs'),
    deleteFailedJob: (args) => ipcRenderer.invoke('hjen:delete-failed-job', args),
    // Projects
    getProjects: () => ipcRenderer.invoke('hjen:get-projects'),
    createProject: (args) => ipcRenderer.invoke('hjen:create-project', args),
    deleteProject: (args) => ipcRenderer.invoke('hjen:delete-project', args),
    renameProject: (args) => ipcRenderer.invoke('hjen:rename-project', args),
    getProjectsRoot: () => ipcRenderer.invoke('hjen:get-projects-root'),
    setProjectsRoot: (root) => ipcRenderer.invoke('hjen:set-projects-root', root),
    pickFolder: () => ipcRenderer.invoke('hjen:pick-folder'),
    // Save + Finder
    saveGeneration: (args) => ipcRenderer.invoke('hjen:save-generation', args),
    openFolder: (path) => ipcRenderer.invoke('hjen:open-folder', path),
    moveGeneration: (args) => ipcRenderer.invoke('hjen:move-generation', args),
    deleteGeneration: (args) => ipcRenderer.invoke('hjen:delete-generation', args),
    // Browse past generations
    listProjectFiles: (args) => ipcRenderer.invoke('hjen:list-project-files', args),
    listAllGenerations: () => ipcRenderer.invoke('hjen:list-all-generations'),
    readSidecar: (jsonPath) => ipcRenderer.invoke('hjen:read-sidecar', jsonPath),
    readImageDataUrl: (imgPath) => ipcRenderer.invoke('hjen:read-image-data-url', imgPath),
    backfillThumbnails: (args) => ipcRenderer.invoke('hjen:backfill-thumbnails', args),
    // Reference library
    listLibrary: () => ipcRenderer.invoke('hjen:list-library'),
    addToLibrary: (args) => ipcRenderer.invoke('hjen:add-to-library', args),
    deleteFromLibrary: (args) => ipcRenderer.invoke('hjen:delete-from-library', args),
    renameLibraryAsset: (args) => ipcRenderer.invoke('hjen:rename-library-asset', args),
    pickImageFiles: () => ipcRenderer.invoke('hjen:pick-image-files'),
    // Skills (Anthropic-style markdown skill files)
    listSkills: () => ipcRenderer.invoke('hjen:list-skills'),
    pickSkillFile: () => ipcRenderer.invoke('hjen:pick-skill-file'),
    importSkill: (args) => ipcRenderer.invoke('hjen:import-skill', args),
    deleteSkill: (args) => ipcRenderer.invoke('hjen:delete-skill', args),
    runSkill: (args) => ipcRenderer.invoke('hjen:run-skill', args),
    listSkillRuns: () => ipcRenderer.invoke('hjen:list-skill-runs'),
});

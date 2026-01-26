export interface LogViewerDeps {
    term: any;
    getWidth: () => number;
    getHeight: () => number;
    onClose: () => void;
    onCloseAndExit: () => void;
    onCloseAndSuspend: () => void;
}
export interface LogViewer {
    open: () => void;
    isOpen: () => boolean;
    handleKey: (key: string) => void;
}
export declare function createLogViewer(deps: LogViewerDeps): LogViewer;
//# sourceMappingURL=logViewer.d.ts.map
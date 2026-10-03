export namespace config {
	
	export class VaultEntry {
	    path: string;
	    name: string;
	    gitRepoUrl?: string;
	    gitBranch?: string;
	    gitAuthMethod?: string;
	
	    static createFrom(source: any = {}) {
	        return new VaultEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.name = source["name"];
	        this.gitRepoUrl = source["gitRepoUrl"];
	        this.gitBranch = source["gitBranch"];
	        this.gitAuthMethod = source["gitAuthMethod"];
	    }
	}
	export class Config {
	    vaultPath: string;
	    vaults?: VaultEntry[];
	    theme?: string;
	    language?: string;
	    gitRepoUrl?: string;
	    gitBranch?: string;
	    gitAuthMethod?: string;
	
	    static createFrom(source: any = {}) {
	        return new Config(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.vaultPath = source["vaultPath"];
	        this.vaults = this.convertValues(source["vaults"], VaultEntry);
	        this.theme = source["theme"];
	        this.language = source["language"];
	        this.gitRepoUrl = source["gitRepoUrl"];
	        this.gitBranch = source["gitBranch"];
	        this.gitAuthMethod = source["gitAuthMethod"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace gitsync {
	
	export class Status {
	    state: string;
	    message: string;
	
	    static createFrom(source: any = {}) {
	        return new Status(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.state = source["state"];
	        this.message = source["message"];
	    }
	}

}

export namespace main {
	
	export class SyncSettings {
	    repoURL: string;
	    branch: string;
	    authMethod: string;
	    hasPAT: boolean;
	
	    static createFrom(source: any = {}) {
	        return new SyncSettings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.repoURL = source["repoURL"];
	        this.branch = source["branch"];
	        this.authMethod = source["authMethod"];
	        this.hasPAT = source["hasPAT"];
	    }
	}

}

export namespace search {
	
	export class Result {
	    path: string;
	    title: string;
	    snippet: string;
	
	    static createFrom(source: any = {}) {
	        return new Result(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.title = source["title"];
	        this.snippet = source["snippet"];
	    }
	}

}

export namespace vault {
	
	export class Node {
	    name: string;
	    path: string;
	    isDir: boolean;
	    children?: Node[];
	
	    static createFrom(source: any = {}) {
	        return new Node(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.isDir = source["isDir"];
	        this.children = this.convertValues(source["children"], Node);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}


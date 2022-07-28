import { App, CachedMetadata, Editor, getAllTags, MarkdownView, MetadataCache, Modal, Notice, parseFrontMatterTags, Plugin, PluginSettingTab, Setting, SuggestModal, TagCache, TFile, Vault } from 'obsidian';

// Remember to rename these classes and interfaces!

const dateRegex = new RegExp(/date: \d{4}\-(0?[1-9]|1[012])\-(0?[1-9]|[12][0-9]|3[01])*/ig);
const tagRegex = new RegExp(/(?<=[\s>]|^)#(\w*[A-Za-z_/-]+\w*)/ig);

interface MyPluginSettings {
	mySetting: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	mySetting: 'default'
}

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;

	async onload() {
		await this.loadSettings();

		const cached = await this.loadCachedStruct();

		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: 'open-modal',
			name: 'Open Tag Selector',
			checkCallback: (checking: boolean) => {
				if (!checking) {
					new SelectorModal(this.app, cached.toSelections()).open();
				}
				// This command will only show up in Command Palette when the check function returns true
				return true;
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.

		// when file change
		this.registerEvent(this.app.metadataCache.on('changed', (file, data, cache) => {
			cached.setFileMap(file, cache, data)
		}));
		this.registerEvent(this.app.metadataCache.on('deleted', (file, data) => {
			cached.deleteFileMap(file)
		}));

	}

	async loadCachedStruct(): Promise<CachedStruct> {
		const { vault } = this.app;

		var cached = new CachedStruct()
		vault.getMarkdownFiles().map((file) => {
			vault.read(file).then((data) => {
				cached.setFileMap(file, this.app.metadataCache.getFileCache(file), data)
			});
		})
		return cached;
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

const SELECTION_KIND = {
	ORPHAN: 'orphan',
	METATAG: 'metatag',
	CONTENT: 'content',
} as const

class CachedStruct {
	fileMap: Map<string, Selection[]>
	constructor() {
		this.fileMap = new Map<string, Selection[]>
	}

	deleteFileMap(file: TFile) {
		this.fileMap.delete(file.path)
	}

	setFileMap(file: TFile, cache: CachedMetadata | null, data: string) {
		let selections: Array<Selection> = []

		let pathTag: string|null = null
		const pathSpl = file.path.split("/") 
		if (pathSpl.length > 1) {
			pathTag = "#" + pathSpl[pathSpl.length-2]
		}

		let headerTags: Array<string> = []

		const date = data.match(dateRegex)?.first()?.substring(6)
		

		// if has header tag
		if (cache?.frontmatter != null) {
	
			parseFrontMatterTags(cache.frontmatter)?.forEach(t => headerTags.push(t))
			if (pathTag != null) {
				headerTags.push(pathTag)
			}
		}


		// no tags and no header tags
		if (cache?.tags == null && headerTags.length == 0) {
			selections.push({
				hasHeader: false,
				date: date,
				kind:  SELECTION_KIND.ORPHAN,
				cursor: 0,
				path: file.path,
				description: "",
				tags: [],
				file: file
			})
			this.fileMap.set(file.path, selections)
			return 
		}

		// push header tag
		if (headerTags.length > 0) {
			selections.push({
				hasHeader: true,
				date: date,
				kind:  SELECTION_KIND.CONTENT,
				cursor: 0,
				path: file.path,
				description: data.replace(/[\r\n]/gm, '  ').substring(0,200),
				tags: headerTags.sort().filter(function(elem, index, self) {
					return index === self.indexOf(elem);
				}),
				file: file
			})
		}
		

		const dataSpl = data.split("\n")
		let offset = 0;
		for (let i = 0 ; i < dataSpl.length ; i++){
			const paragraph = dataSpl[i]
			const tagIdx = paragraph.search(tagRegex)
	
			if (tagIdx != -1) {
				const tags = [...paragraph.matchAll(tagRegex)].map(k => k[0]).join().replace("/",",").split(",");
				tags.push(...headerTags)
				selections.push({
					hasHeader: headerTags.length > 0,
					date: date,
					kind:  SELECTION_KIND.CONTENT,
					cursor: i,
					path: file.path,
					description: data.replace(/[\r\n]/gm, '  ').substring(offset+tagIdx-100, offset+tagIdx+100),
					tags: tags.sort().filter(function(elem, index, self) {
						return index === self.indexOf(elem);
					}),
					file: file
				})
			}
			offset += paragraph.length
		}
		this.fileMap.set(file.path, selections)
	}

	toSelections() : Selection[] {
		let selections: Array<Selection> = []
		this.fileMap.forEach(k => selections.push(...k))
		return selections.sort(compare)
	}
}

interface Selection {
	hasHeader: boolean;
	date: string|undefined;
	kind: string;
	cursor: number;
	file: TFile;
	path: string;
	description: string;
	tags: string[];
}

function compare( a: Selection, b: Selection ) {
	if (a.date == undefined) {
		return 1
	}
	if (b.date == undefined) {
		return -1
	}
	return a.date > b.date ? -1 : 1;
  }

class SelectorModal extends SuggestModal<Selection> {

	allResults: Selection[];


	getSuggestions(query: string): Selection[] | Promise<Selection[]> {
		const getOrphan = query.startsWith("!")
		const getNoMd = query.startsWith("!!")
		let currentPath = ''
		return this.allResults.filter((page) => {
			if (!page.hasHeader && getNoMd){
				return true
			} else if (getOrphan) {
				return page.kind == SELECTION_KIND.ORPHAN;
			} else {
				if (page.kind == SELECTION_KIND.ORPHAN) {
					return false
				}
				for (const subQuery of query.split(" ")) {
					
					const tagsJoin = page.tags.join()
					if (!tagsJoin.contains(subQuery)) {
						return false
					}
				}
				if (page.path != currentPath) {
					page.kind = SELECTION_KIND.METATAG
				}
				currentPath = page.path
				return true
			}

		});
	}

	renderSuggestion(value: Selection, el: HTMLElement) {
		if (value.kind == SELECTION_KIND.CONTENT) {
			const selection = el.createEl("div", { cls: "selection-content" });
			selection.createEl("small", { text: value.description, cls: "selection__description" });
	
			const tagContainer = selection.createEl("p")
			for (let i = 0; i < value.tags.length; i++) {
				tagContainer.createEl("a", { text: value.tags[i], cls: "tag selection__tag" });
			}
		}else if (value.kind == SELECTION_KIND.ORPHAN) {
			const selection = el.createEl("div", { cls: "selection" });
			selection.createEl("div", { text: value.path, cls: "selection__title_bad" });
		}else if (value.kind == SELECTION_KIND.METATAG) {
			const selection = el.createEl("div", { cls: "selection" });
			const title = selection.createEl("div", { text: value.path, cls: "selection__title" });
			title.createEl("small", { text: !value.hasHeader ? ' → (miss metadata)': '', cls: "selection__title_bad" });
			selection.createEl("small", { text: value.description, cls: "selection__description" });
	
			const tagContainer = selection.createEl("p")
			for (let i = 0; i < value.tags.length; i++) {
				tagContainer.createEl("a", { text: value.tags[i], cls: "tag selection__tag" });
			}
		}

	}

	onChooseSuggestion(item: Selection, evt: MouseEvent | KeyboardEvent) {
		const leaf = app.workspace.getLeaf(false)
		leaf.openFile(item.file).then(() => {
			if (leaf.view?.getViewType() === 'markdown') {
				const md = leaf.view as MarkdownView;
				md.editor.setCursor(item.cursor)
			}
		})
		
	}

	constructor(app: App, res: Selection[]) {
		super(app);
		this.allResults = res;
		this.setInstructions([
			{command: "↑↓", purpose: "to navidate"},
			{command: "↵", purpose: "to open"},
			{command: "esc", purpose: "to dismiss"}
		])
		this.setPlaceholder("Type one tag or multiple (eg.: tag1 tag2)")
		this.limit = 20
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		containerEl.createEl('h2', {text: 'Settings for my awesome plugin.'});

		new Setting(containerEl)
			.setName('My setting')
			.setDesc('It\'s a secret')
			.addText(text => text
				.setPlaceholder('Enter your secret')
				.setValue(this.plugin.settings.mySetting)
				.onChange(async (value) => {
					console.log('Secret: ' + value);
					this.plugin.settings.mySetting = value;
					await this.plugin.saveSettings();
				}));
	}
}

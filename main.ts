import { App, CachedMetadata, Editor, getAllTags, MarkdownView, MetadataCache, Modal, Notice, parseFrontMatterTags, Plugin, PluginSettingTab, Setting, SuggestModal, TagCache, TFile, Vault } from 'obsidian';

// Remember to rename these classes and interfaces!

const regex1 = new RegExp(/(?<=[\s>]|^)#(\w*[A-Za-z_/-]+\w*)/ig);

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

		// if has header tag
		if (cache?.frontmatter != null) {
			parseFrontMatterTags(cache.frontmatter)?.forEach(t => headerTags.push(t))
			if (pathTag != null) {
				headerTags.push(pathTag)
			}
			selections.push({
				cursor: 0,
				title: file.path,
				description: data.replace(/[\r\n]/gm, '  ').substring(0,200),
				tags: headerTags.sort().filter(function(elem, index, self) {
					return index === self.indexOf(elem);
				}),
				file: file
			})
		}


		// no tags and no header tags
		if (cache?.tags == null && headerTags.length == 0) {
			selections.push({
				cursor: 0,
				title: file.path,
				description: "",
				tags: [],
				file: file
			})
			this.fileMap.set(file.path, selections)
			return 
		}
		

		const dataSpl = data.split("\n")
		let offset = 0;
		for (let i = 0 ; i < dataSpl.length ; i++){
			const paragraph = dataSpl[i]
			const tagIdx = paragraph.search(regex1)
	
			if (tagIdx != -1) {
				const tags = [...paragraph.matchAll(regex1)].map(k => k[0]);
				tags.push(...headerTags)
				selections.push({
					cursor: i,
					title: file.path,
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
		return selections
	}
}

interface Selection {
	cursor: number;
	file: TFile;
	title: string;
	description: string;
	tags: string[];
}

class SelectorModal extends SuggestModal<Selection> {

	allResults: Selection[];


	getSuggestions(query: string): Selection[] | Promise<Selection[]> {
		const getOrphan = query.startsWith("!")
		return this.allResults.filter((page) => {
			if (getOrphan) {
				return page.tags.length == 0;
			} else {
				if (page.tags.length == 0) {
					return false
				}
				for (const subQuery of query.split(" ")) {
					
					const tagsJoin = page.tags.join()
					if (!tagsJoin.contains(subQuery)) {
						return false
					}
				}
				return true
			}

		});
	}

	renderSuggestion(value: Selection, el: HTMLElement) {
		if (value.tags.length > 0) {
			const selection = el.createEl("div", { cls: "selection" });
			selection.createEl("div", { text: value.title, cls: "selection__title" });
			selection.createEl("small", { text: value.description, cls: "selection__description" });
	
			const tagContainer = selection.createEl("p")
			for (let i = 0; i < value.tags.length; i++) {
				tagContainer.createEl("a", { text: value.tags[i], cls: "tag selection__tag" });
			}
		}else {
			const selection = el.createEl("div", { cls: "selection" });
			selection.createEl("div", { text: value.title, cls: "selection__title_bad" });
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

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
		let modalSelector = new SelectorModal(this.app, cached)

		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: 'open-modal',
			name: 'Open Tag Selector',
			checkCallback: (checking: boolean) => {

				if (!checking) {
					modalSelector.open();
				}
				// This command will only show up in Command Palette when the check function returns true
				return true;
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));

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
}

class CachedStruct {
	files: File[]
	constructor() {
		this.files = []
	}

	deleteFileMap(file: TFile) {
		this.files = this.files.filter(x => x.file != file)
	}

	setFileMap(file: TFile, cache: CachedMetadata | null, data: string) {
		this.deleteFileMap(file)

		let hasHeader = false
		let selections: Array<FileTag> = []

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

		// push header tag
		if (headerTags.length > 0) {
			hasHeader = true
			selections.push({
				cursor: 0,
				description: data.substring(0,400),
				tags: headerTags.sort().filter(function(elem, index, self) {
					return index === self.indexOf(elem);
				}),
			})
		}


		// no tags and no header tags
		if (cache?.tags == null && headerTags.length == 0) {
			selections.push({
				cursor: 0,
				description: "",
				tags: [],
			})
		}
		

		if (cache?.tags != null) {
			const dataSpl = data.split("\n")
			let offset = 0;
			for (let i = 0 ; i < dataSpl.length ; i++){
				const paragraph = dataSpl[i]
				const tagIdx = paragraph.search(tagRegex)
		
				if (tagIdx != -1) {
					const tags = [...paragraph.matchAll(tagRegex)].map(k => k[0]).join().replace("/",",").split(",");
					tags.push(...headerTags)
					selections.push({
						cursor: i,
						description: data.substring(offset+tagIdx-200, offset+tagIdx+200),
						tags: tags.sort().filter(function(elem, index, self) {
							return index === self.indexOf(elem);
						}),
					})
				}
				offset += paragraph.length
			}
		}

		this.files.push({
			fileTags: selections,
			file: file,
			date: date,
			hasHeader: hasHeader
		})
		this.files.sort((a,b) => {
			if (a.date == undefined) {
				return 1
			}
			if (b.date == undefined) {
				return -1
			}
			return a.date > b.date ? -1 : 1;
		})
	}


	search(query: string): Selection[] {
		const getOrphan = query.startsWith("!")
		const getNoMd = query.startsWith("!!")
		let selections: Array<Selection> = []

		for (const file of this.files) {
			if (getNoMd && !file.hasHeader) {
				selections.push({
					path: file.file.path,
					file: file.file,
					hasHeader: false,
					kind: SELECTION_KIND.METATAG,
					cursor: 0,
					description: "",
					tags: []
				})
			}
			if (getOrphan && file.fileTags.length == 0) {
				selections.push({
					path: file.file.path,
					file: file.file,
					hasHeader: false,
					kind: SELECTION_KIND.ORPHAN,
					cursor: 0,
					description: "",
					tags: []
				})
			}

			let isFirst = true
			for (const fileTag of file.fileTags) {
				for (const subQuery of query.split(" ")) {
					
					const tagsJoin = fileTag.tags.join()
					if (!tagsJoin.contains(subQuery)) {
						continue
					}

					let kind = SELECTION_KIND.CONTENT
					if (isFirst) {
						kind = SELECTION_KIND.METATAG
					}

					isFirst = false
					selections.push({
						hasHeader: file.hasHeader,
						file: file.file,
						path: file.file.path,
						kind: kind,
						cursor: fileTag.cursor,
						description: fileTag.description,
						tags: fileTag.tags
					})
				}
			}
		}
		return selections
	}

	getAll(): File[] {
		return this.files
	}
}

interface File {
	hasHeader: boolean;
	file: TFile;
	date: string|undefined;
	fileTags: FileTag[]
}

interface FileTag {
	cursor: number;
	description: string;
	tags: string[];
}

interface Selection {
	hasHeader: boolean
	file: TFile;
	kind: string;
	path: string;
	cursor: number;
	description: string;
	tags: string[];
}

class SelectorModal extends SuggestModal<Selection> {

	cached: CachedStruct;
	allResults: Selection[];
	allTags: string[];
	selectedTags: string[];
	tagContainer: HTMLParagraphElement

	getSuggestions(query: string): Selection[] {
		return this.cached.search(query)
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

	constructor(app: App, cache: CachedStruct) {
		super(app);
				
		this.cached = cache
		this.setInstructions([
			{command: "↑↓", purpose: "to navidate"},
			{command: "↵", purpose: "to open"},
			{command: "esc", purpose: "to dismiss"}
		])
		this.modalEl.style.setProperty("max-width", "90vw")
		this.modalEl.style.setProperty("width", "100%")
		this.modalEl.style.setProperty("max-height", "80vh")
		this.modalEl.style.setProperty("height", "100%")

		this.setPlaceholder("Type one tag or multiple (eg.: tag1 tag2)")
		this.limit = 20


		// const res = cached.toSelections()
		// this.allResults = res;
		// this.allTags = res.map(k => k.tags).join().split(",").unique();
		// this.selectedTags = res.map(k => k.tags).join().split(",").unique();


		// this.tagContainer = this.modalEl.createEl("p")
		// for (const tag of this.allTags.splice(0,30)) {
		// 	this.tagContainer.createEl("a", { text: tag, cls: "tag selection__tag" });
		// }
		// this.tagContainer.insertAfter(this.inputEl)


	}

	// onOpen(): void {
	// 	this.inputEl.setAttribute("value", "fsfs")
	// }

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}

	open(): void {
		super.open()
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

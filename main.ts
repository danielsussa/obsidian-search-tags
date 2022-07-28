import { App, CachedMetadata, Editor, getAllTags, MarkdownView, MetadataCache, Modal, Notice, parseFrontMatterTags, Plugin, PluginSettingTab, Setting, SuggestModal, TagCache, TFile, Vault } from 'obsidian';

// Remember to rename these classes and interfaces!


class CachedStruct {
	constructor() { 
		this.fileMap = new Map<string, FileMap>();
	 } 
	fileMap: Map<string, FileMap>

	setFileMap(file: TFile, cache: CachedMetadata | null, data: string) {
		if (cache == null) {
			this.fileMap.delete(file.name)
			return 
		}
		
		if (cache.tags == null && cache.frontmatter == null) {
			this.fileMap.delete(file.name)
			return
		}

		if (cache.sections == null) {
			this.fileMap.delete(file.name)
			return
		}

		let tagTexts: Array<TagText> = []
		
		
		for (const section of cache.sections) {
			
			let tags: Array<TagCache> = []
			if (cache.frontmatter != null) {
				const tagsOpt = parseFrontMatterTags(cache.frontmatter)
				if (tagsOpt != null) {
					for (const tag of tagsOpt) {
						tags.push({
							tag: tag,
							position: {start: {line: 0, col: 0, offset: 0}, end: {line: 0, col: 0, offset: 0}} 
						})
					}
				}
			}
			if (cache.tags != null) {
				for (const tag of cache.tags) {
					if (tag.position.start.offset >= section.position.start.offset && tag.position.end.offset <= section.position.end.offset) {
						tags.push(tag)
					}
				}
			}
			if (tags.length > 0) {
				tagTexts.push({
					tags: tags,
					text: data.substring(tags[0].position.start.offset - 100, tags[0].position.end.offset + 100),
					cursor: tags[0].position.start.line
				})
			}
		}

		this.fileMap.set(file.name, {
			path: file.path,
			tagTexts: tagTexts,
			file: file
		})
	}

	toSelections() : Selection[] {
		let selections: Array<Selection> = []

		for(let key of this.fileMap.keys()) {
			const fileMap = this.fileMap.get(key)
			if (fileMap?.tagTexts == null) {
				continue
			}
			for(let tagText of fileMap.tagTexts) {
				selections.push({
					title: fileMap.path,
					description: tagText.text.replace(/[\r\n]/gm, '  '),
					tags: tagText.tags.map(k => k.tag),
					file: fileMap.file,
					cursor: tagText.cursor
				})
			}
		 }
		return selections
	}
}

class FileMap {
	file: TFile;
	path: string;
	tagTexts: TagText[];
}

class TagText {
	text: string
	cursor: number
	tags: TagCache[];
}

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
				// const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				// if (markdownView) {
				// 	// If checking is true, we're simply "checking" if the command can be run.

				// }

				// If checking is false, then we want to actually perform the operation.
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
		const querySpl = query.split(" ")
		return this.allResults.filter((page) => {
			for (let i = 0; i < querySpl.length; i++) {
				const subQuery = querySpl[i]
				const tagsJoin = page.tags.join() // ["fdsfs", "ffgg"]
				if (!tagsJoin.contains(subQuery)) {
					return false
				}
			}
			return true
		});
	}
	// renderSuggestion(value: Selection, el: HTMLElement) {

	// 	const result1 = el.createEl("div",{ cls: "suggestion-item mod-complex qsp-suggestion-headings qsp-headings-l1"})
	// 	const result1Content = result1.createEl("div",{ cls: "suggestion-content qsp-content"});
	// 	// title
	// 	result1Content.createEl("div",{ cls: "suggestion-title qsp-title", text: value.title})
	// 	// sugestion note
	// 	result1Content.createEl("div",{ cls: "suggestion-note qsp-note"}).createEl("span",{ cls:"qsp-path", text: value.description})
	// 	// right element
	// 	result1.createEl("div", {cls:"suggestion-aux qsp-aux"}).createEl("span",{cls:"suggestion-flair qsp-headings-indicator", text:"H₁"})
		
	// 	const tagContainer = el.createEl("div").createEl("p")
	// 	for (let i = 0; i < value.tags.length; i++) {
	// 		tagContainer.createEl("a", { text: value.tags[i], cls: "tag" });
	// 	}
	// }

	renderSuggestion(value: Selection, el: HTMLElement) {
		const selection = el.createEl("div", { cls: "selection" });
		selection.createEl("div", { text: value.title, cls: "selection__title" });
		selection.createEl("small", { text: value.description, cls: "selection__description" });

		const tagContainer = selection.createEl("p")
		for (let i = 0; i < value.tags.length; i++) {
			tagContainer.createEl("a", { text: value.tags[i], cls: "tag selection__tag" });
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

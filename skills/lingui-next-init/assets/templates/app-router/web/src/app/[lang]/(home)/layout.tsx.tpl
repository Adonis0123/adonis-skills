import { withServerLayouts } from "{{SERVER_LAYOUTS_IMPORT_PATH}}";
import { I18nServerLayout } from "@/i18n/layout-factory";

function HomeLayout(props: {
	children: React.ReactNode;
	params: Promise<{ lang: string }>;
}) {
	return props.children;
}

export default withServerLayouts(HomeLayout, [I18nServerLayout]);
